import React, { useEffect, useState, useRef } from "react";
import "./App.css";

type ImageMeta = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  is_corrupted: boolean;
  created_at: string;
};

type LogEntry = {
  id: number;
  message: string;
};

function App() {
  const [images, setImages] = useState<ImageMeta[]>([]);
  const [selectedImage, setSelectedImage] = useState<ImageMeta | null>(null);
  const [activeTab, setActiveTab] = useState<"gallery" | "single">("gallery");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [gallerySelectionMode, setGallerySelectionMode] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [initialZoom, setInitialZoom] = useState(1);
  const [imageReady, setImageReady] = useState(false);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const [uploadSummary, setUploadSummary] = useState<{
    totalFiles: number;
    totalSize: number;
    corruptedCount: number;
  } | null>(null);

  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const offsetStartRef = useRef<{ x: number; y: number } | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [typeFilter, setTypeFilter] = useState<"all" | "jpeg" | "png" | "tiff">(
    "all"
  );

  const [syncSummary, setSyncSummary] = useState<{
    totalDbBefore: number;
    totalDisk: number;
    addedFromDisk: number;
    markedMissing: number;
    healed: number;
  } | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);

  const API_BASE = "http://localhost:4000";

  const addLog = (message: string) => {
    setLogs((prev) => [{ id: Date.now(), message }, ...prev]);
  };

  const filteredImages = images.filter((img) => {
    if (typeFilter === "all") return true;

    const mime = img.mime_type.toLowerCase();

    if (typeFilter === "jpeg") {
      return mime.includes("jpeg") || mime.includes("jpg");
    }
    if (typeFilter === "png") {
      return mime.includes("png");
    }
    if (typeFilter === "tiff") {
      return mime.includes("tiff") || mime.includes("tif");
    }

    return true;
  });

  const fetchImages = async () => {
    try {
      const res = await fetch(`${API_BASE}/images`);
      const data = await res.json();
      setImages(data);
      setSelectedIds((prev) =>
        prev.filter((id) => data.some((img: ImageMeta) => img.id === id))
      );
      addLog(`Loaded ${data.length} images from server`);
    } catch (err) {
      console.error(err);
      addLog("Failed to load images");
    }
  };

  useEffect(() => {
    fetchImages();
  }, []);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));

    setIsUploading(true);
    try {
      const res = await fetch(`${API_BASE}/upload/batch`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        addLog("Batch upload failed");
        return;
      }

      const payload = await res.json();

      setUploadSummary({
        totalFiles: payload.totalFiles,
        totalSize: payload.totalSize,
        corruptedCount: payload.corruptedCount ?? 0,
      });

      addLog(
        `Uploaded ${payload.totalFiles} file(s), ${(
          payload.totalSize / 1024
        ).toFixed(1)} KB, corrupted: ${payload.corruptedCount ?? 0}`
      );

      await fetchImages();
    } catch (err) {
      console.error(err);
      addLog("Batch upload crashed");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const delta = -event.deltaY;
    const factor = delta > 0 ? 1.1 : 0.9;

    setZoom((prev) => {
      let next = prev * factor;
      if (next < initialZoom * 0.25) next = initialZoom * 0.25;
      if (next > initialZoom * 5) next = initialZoom * 5;
      return Number(next.toFixed(2));
    });
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (selectionMode) {
      // start selection
      selectionStartRef.current = { x, y };
      setSelection(null);
    } else {
      // start panning
      setIsPanning(true);
      panStartRef.current = { x: event.clientX, y: event.clientY };
      offsetStartRef.current = { ...offset };
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (selectionMode) {
      if (!selectionStartRef.current) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const start = selectionStartRef.current;
      const width = x - start.x;
      const height = y - start.y;

      const normalized = {
        x: width >= 0 ? start.x : x,
        y: height >= 0 ? start.y : y,
        width: Math.abs(width),
        height: Math.abs(height),
      };

      setSelection(normalized);
      return;
    }

    if (!isPanning || !panStartRef.current || !offsetStartRef.current) return;

    const dx = event.clientX - panStartRef.current.x;
    const dy = event.clientY - panStartRef.current.y;

    setOffset({
      x: offsetStartRef.current.x + dx,
      y: offsetStartRef.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    selectionStartRef.current = null;
  };

  const handleCreateFromSelection = async () => {
    if (!selectedImage || !selection || !canvasRef.current || !imgRef.current)
      return;

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const imgRect = imgRef.current.getBoundingClientRect();

    // selection in page coords
    const selLeft = canvasRect.left + selection.x;
    const selTop = canvasRect.top + selection.y;
    const selRight = selLeft + selection.width;
    const selBottom = selTop + selection.height;

    // intersect selection with image box
    const interLeft = Math.max(selLeft, imgRect.left);
    const interTop = Math.max(selTop, imgRect.top);
    const interRight = Math.min(selRight, imgRect.right);
    const interBottom = Math.min(selBottom, imgRect.bottom);

    const interWidth = interRight - interLeft;
    const interHeight = interBottom - interTop;

    if (interWidth <= 0 || interHeight <= 0) {
      addLog("Selection does not overlap image");
      return;
    }

    const normX = (interLeft - imgRect.left) / imgRect.width;
    const normY = (interTop - imgRect.top) / imgRect.height;
    const normW = interWidth / imgRect.width;
    const normH = interHeight / imgRect.height;

    try {
      const res = await fetch(`${API_BASE}/images/${selectedImage.id}/crop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x: normX,
          y: normY,
          width: normW,
          height: normH,
        }),
      });

      if (!res.ok) {
        addLog("Crop failed");
        return;
      }

      const payload = await res.json();
      addLog(`Created cropped image ${payload.image.filename}`);
      setSelection(null);
      await fetchImages();
    } catch (err) {
      console.error(err);
      addLog("Crop request crashed");
    }
  };

  const handleThumbClick = (
    img: ImageMeta,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    // always update the "current" image for the viewer
    setSelectedImage(img);
    setImageReady(false);

    setSelectedIds((prev) => {
      if (gallerySelectionMode) {
        // multi-select: toggle membership
        if (prev.includes(img.id)) {
          return prev.filter((id) => id !== img.id);
        }
        return [...prev, img.id];
      }

      // normal mode: single select
      return [img.id];
    });
  };

  const handleExportSelected = async () => {
    const ipc = (window as any).ipcRenderer;

    if (!ipc || typeof ipc.invoke !== "function") {
      addLog("Export not available in this environment");
      return;
    }

    const selectedImages = images.filter((img) => selectedIds.includes(img.id));

    if (selectedImages.length === 0) {
      addLog("No images selected for export");
      return;
    }

    try {
      const result = await ipc.invoke(
        "pixelsync:export-images",
        selectedImages.map((img) => ({
          path: img.storage_path,
          filename: img.filename,
        }))
      );

      if (!result || !result.targetDir) {
        addLog("Export canceled");
        return;
      }

      addLog(
        `Exported ${result.exported} file${
          result.exported !== 1 ? "s" : ""
        } to ${result.targetDir}`
      );
    } catch (err) {
      console.error(err);
      addLog("Export failed");
    }
  };

  const handleRunSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/sync`, {
        method: "POST",
      });

      if (!res.ok) {
        addLog("Sync failed");
        return;
      }

      const payload = await res.json();
      setSyncSummary(payload);

      addLog(
        `Sync complete. Added ${payload.addedFromDisk}, marked missing ${payload.markedMissing}, healed ${payload.healed}`
      );

      // pull fresh images so UI matches server
      await fetchImages();
    } catch (err) {
      console.error(err);
      addLog("Sync request crashed");
    } finally {
      setIsSyncing(false);
    }
  };

  const resetView = () => {
    setZoom(initialZoom);
    setOffset({ x: 0, y: 0 });
  };

  const zoomIn = () => {
    setZoom((prev) => Math.min(prev * 1.2, 5));
  };

  const zoomOut = () => {
    setZoom((prev) => Math.max(prev / 1.2, 0.2));
  };

  return (
    <div className="app-shell">
      {/* Left panel: upload */}
      <div className="left-panel">
        <h2>PixelSync</h2>
        <p className="sub">Upload images to the server</p>

        {uploadSummary && (
          <div className="upload-summary">
            <div>
              <strong>{uploadSummary.totalFiles}</strong> file
              {uploadSummary.totalFiles !== 1 && "s"} uploaded
            </div>
            <div>
              Total size: {(uploadSummary.totalSize / 1024).toFixed(1)} KB
            </div>
            <div>Corrupted: {uploadSummary.corruptedCount}</div>
          </div>
        )}

        <div className="sync-card">
          <div className="sync-header">
            <span>Sync control</span>
            <button
              className="sync-button"
              onClick={handleRunSync}
              disabled={isSyncing}
            >
              {isSyncing ? "Syncing..." : "Run sync"}
            </button>
          </div>
          {syncSummary && (
            <ul>
              <li>
                DB before: {syncSummary.totalDbBefore} rows, disk:{" "}
                {syncSummary.totalDisk} files
              </li>
              <li>Added from disk: {syncSummary.addedFromDisk}</li>
              <li>Marked missing: {syncSummary.markedMissing}</li>
              <li>Healed: {syncSummary.healed}</li>
            </ul>
          )}
        </div>

        <label className="upload-button">
          <span>{isUploading ? "Uploading..." : "Choose images"}</span>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.tif,.tiff"
            multiple
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
        <div className="top-row">
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

          <div className="right-controls">
            <div className="filters">
              <button
                className={typeFilter === "all" ? "chip active" : "chip"}
                onClick={() => setTypeFilter("all")}
              >
                All
              </button>
              <button
                className={typeFilter === "jpeg" ? "chip active" : "chip"}
                onClick={() => setTypeFilter("jpeg")}
              >
                JPEG
              </button>
              <button
                className={typeFilter === "png" ? "chip active" : "chip"}
                onClick={() => setTypeFilter("png")}
              >
                PNG
              </button>
              <button
                className={typeFilter === "tiff" ? "chip active" : "chip"}
                onClick={() => setTypeFilter("tiff")}
              >
                TIFF
              </button>
            </div>

            <button
              className={
                gallerySelectionMode
                  ? "chip selection-toggle active"
                  : "chip selection-toggle"
              }
              onClick={() => setGallerySelectionMode((prev) => !prev)}
            >
              {"Multi-select"}
            </button>
          </div>
        </div>

        {activeTab === "gallery" && (
          <div className="gallery">
            <div className="gallery-header">
              <span>
                Showing {filteredImages.length} of {images.length} image
                {images.length !== 1 && "s"}
              </span>

              <span className="selected-info">
                {selectedIds.length} selected
                {selectedIds.length > 0 && (
                  <>
                    <button
                      className="clear-selection"
                      onClick={() => setSelectedIds([])}
                    >
                      Clear
                    </button>
                    <button
                      className="export-selection"
                      onClick={handleExportSelected}
                    >
                      Export
                    </button>
                  </>
                )}
              </span>
            </div>

            {filteredImages.length === 0 && (
              <p className="empty">No images match this filter</p>
            )}

            <div className="gallery-grid">
              {filteredImages.map((img) => (
                <button
                  key={img.id}
                  className={
                    selectedIds.includes(img.id)
                      ? "thumb-card selected"
                      : "thumb-card"
                  }
                  onClick={(event) => {
                    // single click just selects
                    handleThumbClick(img, event);
                  }}
                  onDoubleClick={() => {
                    // double click selects + switches tab
                    if (img.is_corrupted) {
                      addLog(`Selected corrupted image: ${img.filename}`);
                    }

                    setSelectedImage(img);
                    setImageReady(false);
                    setActiveTab("single");
                  }}
                >
                  <div className="thumb-wrapper">
                    <img
                      src={`${API_BASE}/files/${img.id}`}
                      alt={img.filename}
                      className="thumb-img"
                    />
                  </div>
                  {img.is_corrupted && (
                    <span className="corrupted-icon">!</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === "single" &&
          selectedImage &&
          (selectedImage.is_corrupted ? (
            <div className="single-viewer empty">
              <h3>{selectedImage.filename}</h3>
              <p className="single-meta">
                {selectedImage.mime_type} ·{" "}
                {(selectedImage.size_bytes / 1024).toFixed(1)} KB
              </p>
              <p className="corrupted-message">
                This image is marked as corrupted or missing on the server.
              </p>
              <p className="corrupted-message">
                Restore the file in the server storage and run sync to heal it.
              </p>
            </div>
          ) : (
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
                      setSelectionMode((prev) => !prev);
                      setSelection(null);
                      selectionStartRef.current = null;
                      setIsPanning(false);
                    }}
                  >
                    {selectionMode ? "Selection on" : "Selection off"}
                  </button>
                  <button
                    disabled={!selection || selectedImage?.is_corrupted}
                    onClick={handleCreateFromSelection}
                  >
                    Crop
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
                    onLoad={() => {
                      const img = imgRef.current;
                      const canvas = canvasRef.current;
                      if (!img || !canvas) return;

                      // actual available space
                      const canvasW = canvas.clientWidth;
                      const canvasH = canvas.clientHeight;

                      const imgW = img.naturalWidth || 1;
                      const imgH = img.naturalHeight || 1;

                      // small padding so it is not glued to the edges
                      const padding = 24;
                      const usableW = canvasW - padding;
                      const usableH = canvasH - padding;

                      const scale = Math.min(usableW / imgW, usableH / imgH);

                      // clamp a little in case images are tiny or huge
                      const clamped = Math.max(0.1, Math.min(scale, 3));

                      setInitialZoom(clamped);
                      setZoom(clamped);
                      setOffset({ x: 0, y: 0 });

                      setImageReady(true);
                    }}
                    style={{
                      transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                      transformOrigin: "center center",
                      opacity: imageReady ? 1 : 0,
                      transition: "opacity 120ms ease-out",
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
                      height: selection.height,
                    }}
                  />
                )}
              </div>

              <p className="hint">Scroll to zoom. Drag to pan.</p>
            </div>
          ))}
      </div>

      {/* Bottom panel: logs */}
      <div className="bottom-panel">
        <h3>Activity log</h3>
        <ul>
          {logs.map((log) => (
            <li key={log.id}>{log.message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;
