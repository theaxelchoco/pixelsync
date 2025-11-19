import express from "express"
import cors from "cors"
import multer from "multer"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import dotenv from "dotenv"
import pkg from "pg"
import sharp from "sharp"

dotenv.config()
const { Pool } = pkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

//data connection pool
const pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || "pixelsync",
    password: process.env.PGPASSWORD || "pixelsync",
    database: process.env.PGDATABASE || "pixelsync_db"
})

//Creating storage and mock directories
const storageRoot = path.resolve(__dirname, "..", "..", "storage", "mock")
if (!fs.existsSync(storageRoot)) {
    fs.mkdirSync(storageRoot, { recursive: true })
}

//app init
const app = express()
app.use(cors())
app.use(express.json())

const storage = multer.diskStorage({
    destination(req, file, cb) {
        cb(null, storageRoot)
    },
    filename(req, file, cb) {
        cb(null, Date.now() + "_" + file.originalname)
    }
})

const upload = multer({ storage })
const multiUpload = multer({ storage })

//API routes
app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1")
        res.json({ status: "ok", db: "connected" })
    } catch (err) {
        console.error(err)
        res.status(500).json({ status: "error", error: "DB connection failed" })
    }
})

app.get("/images", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, filename, mime_type, size_bytes, storage_path, is_corrupted, created_at FROM images ORDER BY created_at DESC"
        )
        res.json(result.rows)
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Failed to fetch images" })
    }
})

app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        const file = req.file
        if (!file) return res.status(400).json({ error: "No file uploaded" })

        const insertQuery = `
      INSERT INTO images (filename, mime_type, size_bytes, storage_path, is_corrupted)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `
        const values = [
            file.originalname,
            file.mimetype,
            file.size,
            file.path,
            false
        ]

        const result = await pool.query(insertQuery, values)

        res.status(201).json({
            message: "File uploaded",
            image: result.rows[0]
        })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Upload failed" })
    }
})

app.post("/upload/batch", multiUpload.array("files", 50), async (req, res) => {
    try {
        const files = req.files || []

        if (!files.length) {
            return res.status(400).json({ error: "No files uploaded" })
        }

        let totalSize = 0
        const insertedImages = []

        for (const file of files) {
            totalSize += file.size

            const insertQuery = `
        INSERT INTO images (filename, mime_type, size_bytes, storage_path, is_corrupted)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `
            const values = [
                file.originalname,
                file.mimetype,
                file.size,
                file.path,
                false
            ]

            const result = await pool.query(insertQuery, values)
            insertedImages.push(result.rows[0])
        }

        res.status(201).json({
            message: "Batch upload complete",
            totalFiles: files.length,
            totalSize,
            corruptedCount: 0, // placeholder for now
            images: insertedImages
        })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Batch upload failed" })
    }
})

app.get("/files/:id", async (req, res) => {
    try {
        const { id } = req.params
        const result = await pool.query(
            "SELECT storage_path, mime_type FROM images WHERE id = $1",
            [id]
        )

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Image not found" })
        }

        const { storage_path, mime_type } = result.rows[0]

        if (!fs.existsSync(storage_path)) {
            return res.status(404).json({ error: "File missing on disk" })
        }

        res.type(mime_type)
        fs.createReadStream(storage_path).pipe(res)
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Failed to read file" })
    }
})

app.post("/images/:id/crop", async (req, res) => {
    try {
        const { id } = req.params
        const { x, y, width, height } = req.body

        if (
            typeof x !== "number" ||
            typeof y !== "number" ||
            typeof width !== "number" ||
            typeof height !== "number"
        ) {
            return res.status(400).json({ error: "Invalid crop data" })
        }

        const result = await pool.query(
            "SELECT filename, storage_path, mime_type, size_bytes FROM images WHERE id = $1",
            [id]
        )

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Image not found" })
        }

        const row = result.rows[0]
        const inputPath = row.storage_path

        if (!fs.existsSync(inputPath)) {
            return res.status(404).json({ error: "File missing on disk" })
        }

        const img = sharp(inputPath)
        const meta = await img.metadata()

        const imgWidth = meta.width || 0
        const imgHeight = meta.height || 0

        if (!imgWidth || !imgHeight) {
            return res.status(500).json({ error: "Missing image dimensions" })
        }

        const cropRegion = {
            left: Math.round(x * imgWidth),
            top: Math.round(y * imgHeight),
            width: Math.round(width * imgWidth),
            height: Math.round(height * imgHeight)
        }

        const newBuffer = await img.extract(cropRegion).toBuffer()

        const baseName = path.basename(row.filename)
        const newFilename = `crop_${Date.now()}_${baseName}`
        const newPath = path.join(storageRoot, newFilename)

        fs.writeFileSync(newPath, newBuffer)

        const stats = fs.statSync(newPath)

        const insertQuery = `
      INSERT INTO images (filename, mime_type, size_bytes, storage_path, is_corrupted)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `
        const values = [
            newFilename,
            row.mime_type,
            stats.size,
            newPath,
            false
        ]

        const inserted = await pool.query(insertQuery, values)

        res.status(201).json({
            message: "Cropped image created",
            image: inserted.rows[0]
        })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Crop failed" })
    }
})


//port listening
const port = Number(process.env.PORT) || 4000
app.listen(port, () => {
    console.log(`PixelSync API running on http://localhost:${port}`)
})