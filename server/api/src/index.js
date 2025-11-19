import express from "express"
import cors from "cors"
import multer from "multer"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import dotenv from "dotenv"
import pkg from "pg"

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

//port listening
const port = Number(process.env.PORT) || 4000
app.listen(port, () => {
    console.log(`PixelSync API running on http://localhost:${port}`)
})