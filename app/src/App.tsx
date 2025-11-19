import React, { useEffect, useState, useRef } from "react"
import "./App.css"

type ImageMeta = {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  storage_path: string
  is_corrupted: boolean
  created_at: string
}

type LogEntry = {
  id: number
  message: string
}

function App() {
  const [images, setImages] = useState<ImageMeta[]>([])
  const [selectedImage, setSelectedImage] = useState<ImageMeta | null>(null)
  const [activeTab, setActiveTab] = useState<"gallery" | "single">("gallery")
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)

  const panStartRef = useRef<{ x: number; y: number } | null>(null)
  const offsetStartRef = useRef<{ x: number; y: number } | null>(null)

  const [selectionMode, setSelectionMode] = useState(false)
  const [selection, setSelection] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)

  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const API_BASE = "http://localhost:4000"

  const addLog = (message: string) => {
    setLogs(prev => [{ id: Date.now(), message }, ...prev])
  }

  const fetchImages = async () => {
    try {
      const res = await fetch(`${API_BASE}/images`)
      const data = await res.json()
      setImages(data)
      addLog(`Loaded ${data.length} images from server`)
    } catch (err) {
      console.error(err)
      addLog("Failed to load images")
    }
  }

  useEffect(() => {
    fetchImages()
  }, [])

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    const file = files[0]

    const formData = new FormData()
    formData.append("file", file)

    setIsUploading(true)
    try {
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData
      })

      if (!res.ok) {
        addLog("Upload failed")
        return
      }

      const payload = await res.json()
      addLog(`Uploaded ${payload.image.filename}`)

      await fetchImages()
    } catch (err) {
      console.error(err)
      addLog("Upload crashed")
    } finally {
      setIsUploading(false)
      // allow same file to be picked again if needed
      event.target.value = ""
    }
  }

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()

    const delta = -event.deltaY
    const factor = delta > 0 ? 1.1 : 0.9

    setZoom(prev => {
      let next = prev * factor
      if (next < 0.2) next = 0.2
      if (next > 5) next = 5
      return Number(next.toFixed(2))
    })
  }

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    if (selectionMode) {
      // start selection
      selectionStartRef.current = { x, y }
      setSelection(null)
    } else {
      // start panning
      setIsPanning(true)
      panStartRef.current = { x: event.clientX, y: event.clientY }
      offsetStartRef.current = { ...offset }
    }
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (selectionMode) {
      if (!selectionStartRef.current) return

      const rect = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      const start = selectionStartRef.current
      const width = x - start.x
      const height = y - start.y

      const normalized = {
        x: width >= 0 ? start.x : x,
        y: height >= 0 ? start.y : y,
        width: Math.abs(width),
        height: Math.abs(height)
      }

      setSelection(normalized)
      return
    }

    if (!isPanning || !panStartRef.current || !offsetStartRef.current) return

    const dx = event.clientX - panStartRef.current.x
    const dy = event.clientY - panStartRef.current.y

    setOffset({
      x: offsetStartRef.current.x + dx,
      y: offsetStartRef.current.y + dy
    })
  }

  const handleMouseUp = () => {
    setIsPanning(false)
    selectionStartRef.current = null
  }

  const handleCreateFromSelection = async () => {
    if (!selectedImage || !selection || !canvasRef.current || !imgRef.current)
      return

    const canvasRect = canvasRef.current.getBoundingClientRect()
    const imgRect = imgRef.current.getBoundingClientRect()

    // selection in page coords
    const selLeft = canvasRect.left + selection.x
    const selTop = canvasRect.top + selection.y
    const selRight = selLeft + selection.width
    const selBottom = selTop + selection.height

    // intersect selection with image box
    const interLeft = Math.max(selLeft, imgRect.left)
    const interTop = Math.max(selTop, imgRect.top)
    const interRight = Math.min(selRight, imgRect.right)
    const interBottom = Math.min(selBottom, imgRect.bottom)

    const interWidth = interRight - interLeft
    const interHeight = interBottom - interTop

    if (interWidth <= 0 || interHeight <= 0) {
      addLog("Selection does not overlap image")
      return
    }

    const normX = (interLeft - imgRect.left) / imgRect.width
    const normY = (interTop - imgRect.top) / imgRect.height
    const normW = interWidth / imgRect.width
    const normH = interHeight / imgRect.height

    try {
      const res = await fetch(`${API_BASE}/images/${selectedImage.id}/crop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x: normX,
          y: normY,
          width: normW,
          height: normH
        })
      })

      if (!res.ok) {
        addLog("Crop failed")
        return
      }

      const payload = await res.json()
      addLog(`Created cropped image ${payload.image.filename}`)
      setSelection(null)
      await fetchImages()
    } catch (err) {
      console.error(err)
      addLog("Crop request crashed")
    }
  }



  const resetView = () => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  const zoomIn = () => {
    setZoom(prev => Math.min(prev * 1.2, 5))
  }

  const zoomOut = () => {
    setZoom(prev => Math.max(prev / 1.2, 0.2))
  }

  


  return (
    <div className="app-shell">
      {/* Left panel: upload */}
      <div className="left-panel">
        <h2>PixelSync</h2>
        <p className="sub">Upload images to the server</p>

        <label className="upload-button">
          <span>{isUploading ? "Uploading..." : "Choose image"}</span>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.tif,.tiff"
            onChange={handleUpload}
            disabled={isUploading}
          />
        </label>

        <button className="refresh-button" onClick={fetchImages}>
          Refresh list
        </button>
      </div>

      {/* Center panel: gallery + single viewer */}
      <div className="center-panel">
        <div className="tabs">
          <button
            className={activeTab === "gallery" ? "tab active" : "tab"}
            onClick={() => setActiveTab("gallery")}
          >
            Gallery
          </button>
          <button
            className={activeTab === "single" ? "tab active" : "tab"}
            onClick={() => setActiveTab("single")}
            disabled={!selectedImage}
          >
            Single viewer
          </button>
        </div>

        {activeTab === "gallery" && (
          <div className="gallery">
            {images.length === 0 && <p className="empty">No images yet</p>}

            <div className="gallery-grid">
              {images.map(img => (
                <button
                  key={img.id}
                  className={
                    selectedImage?.id === img.id
                      ? "thumb-card selected"
                      : "thumb-card"
                  }
                  onClick={() => {
                    // single click just selects
                    setSelectedImage(img)
                  }}
                  onDoubleClick={() => {
                    // double click selects + switches tab
                    setSelectedImage(img)
                    setActiveTab("single")
                  }}
                >
                  <div className="thumb-wrapper">
                    <img
                      src={`${API_BASE}/files/${img.id}`}
                      alt={img.filename}
                      className="thumb-img"
                    />
                  </div>
                  <div className="image-name">{img.filename}</div>
                  <div className="image-meta">
                    <span>{img.mime_type}</span>
                    <span>{(img.size_bytes / 1024).toFixed(1)} KB</span>
                    {img.is_corrupted && <span className="badge">corrupted</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}


        {activeTab === "single" && selectedImage && (
          <div className="single-viewer">
            <div className="single-header">
              <div>
                <h3>{selectedImage.filename}</h3>
                <p className="single-meta">
                  {selectedImage.mime_type} ·{" "}
                  {(selectedImage.size_bytes / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="viewer-controls">
                <button onClick={zoomOut}>−</button>
                <span>{Math.round(zoom * 100)}%</span>
                <button onClick={zoomIn}>+</button>
                <button onClick={resetView}>Reset</button>
                <button
                  className={selectionMode ? "toggle active" : "toggle"}
                  onClick={() => {
                    setSelectionMode(prev => !prev)
                    setSelection(null)
                    selectionStartRef.current = null
                    setIsPanning(false)
                  }}
                >
                  {selectionMode ? "Selection on" : "Selection off"}
                </button>
                <button
                  disabled={!selection}
                  onClick={handleCreateFromSelection}
                >
                  Create image
                </button>
              </div>

            </div>

            <div
              className={
                isPanning ? "viewer-canvas panning" : "viewer-canvas"
              }
              ref={canvasRef}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div className="viewer-inner">
                <img
                  ref={imgRef}
                  src={`${API_BASE}/files/${selectedImage.id}`}
                  alt={selectedImage.filename}
                  className="viewer-img"
                  style={{
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                    transformOrigin: "center center"
                  }}
                  draggable={false}
                />
              </div>

              {selection && (
                <div
                  className="selection-rect"
                  style={{
                    left: selection.x,
                    top: selection.y,
                    width: selection.width,
                    height: selection.height
                  }}
                />
              )}
            </div>


            <p className="hint">Scroll to zoom. Drag to pan.</p>
          </div>
        )}


        {activeTab === "single" && !selectedImage && (
          <div className="single-viewer empty">
            <p>Select an image from the gallery to view it here</p>
          </div>
        )}
      </div>

      {/* Bottom panel: logs */}
      <div className="bottom-panel">
        <h3>Activity log</h3>
        <ul>
          {logs.map(log => (
            <li key={log.id}>{log.message}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default App
