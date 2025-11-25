# PixelSync

PixelSync is an image management tool built with Electron, React, Node and PostgreSQL.

It simulates an imaging pipeline where the desktop client connects to a server-sided database and storage, keeps them in sync and lets the user review and export images.

## Table of contents

- [Architecture overview](#architecture-overview)
- [Folder structure](#folder-structure)
- [Core features](#core-features)
- [Sync strategy](#sync-strategy)
- [Sync conflict strategy](#sync-conflict-strategy)
- [Data flow](#data-flow)
  - [Upload flow](#upload-flow)
  - [Sync flow](#sync-flow)
  - [Crop flow](#crop-flow)
  - [Export flow](#export-flow)
- [Running the project](#running-the-project)
  - [Requirements](#requirements)
  - [Start PostgreSQL with Docker](#start-postgresql-with-docker)
  - [Run the API server](#run-the-api-server)
  - [Run the Electron app](#run-the-electron-app)
- [API reference](#api-reference)
- [Implementation notes and tradeoffs](#implementation-notes-and-tradeoffs)
- [Future improvements](#future-improvements)

## Architecture overview

PixelSync is built as a small three tier system.

- **Electron desktop app (app/)**

  - React plus Vite frontend rendered inside an Electron shell
  - Communicates with the API using HTTP
  - Provides gallery, single viewer, crop, sync control, and export

- **Node API server (server/api/)**

  - Express based REST API
  - Connects to PostgreSQL using `pg`
  - Handles all reads and writes to the database
  - Manages file uploads, cropping, sync logic, and corruption detection

- **PostgreSQL database (Docker container)**

  - Runs in a separate container managed by `docker compose`
  - Stores image metadata and sync state
  - Acts as the server side database

- **Mounted storage (server/storage/mock/)**
  - Local folder used as server side image storage
  - API stores uploaded files here
  - Sync logic compares this folder with database contents

## Folder structure

```text
.
├── app/
│   ├── src/
│   │   ├── App.tsx
│   │   └── App.css
│   ├── electron/
│   ├── public/
│   └── package.json
│
├── server/
│   ├── api/
│   │   ├── src/
│   │   ├── .env
│   │   └── package.json
│   ├── db/
│   │   └── init.sql
│   └── storage/
│       └── mock/
│
├── docker-compose.yml
└── README.md
```

## Core features

### Gallery

- Pure thumbnail grid with object-fit cover
- Hover zoom animation
- Multi select mode
- File type filters
- Corrupted file indicator badge
- Export selected images

### Single viewer

- Auto-fit image to window on load
- Smooth zoom and pan
- Region selection rectangle
- Server side crop that creates a new image record

### Upload

- Single and batch upload
- Image metadata extraction using sharp
- Corruption detection on decode failures

### Sync

- Manual sync control
- Server always wins model
- Detects:
  - Files missing from storage
  - New files in storage
  - Heals corrupted records when restored
- Logs sync summary in the activity panel

### Export

- Multi-select integration
- Folder chooser dialog via Electron
- Timestamped filenames to prevent conflicts

### Activity log

- Records events such as uploads, sync runs, selections, exports, and crop operations

## Sync strategy

PixelSync uses a simple, deterministic approach: **server is the source of truth**.

Rules:

- Database and storage define the correct state
- Desktop app never overwrites storage files
- Sync brings the database in line with storage
- Missing files → database rows marked corrupted
- Restored files → healed
- New files found on disk → inserted into the database

### Sync conflict strategy

PixelSync implements the **Server Always Wins** synchronization model.

This means that the server side PostgreSQL database and the mounted storage folder are treated as the authoritative source of truth. Whenever a sync is triggered, the desktop client updates its state to match what the server reports without attempting to override server data.

#### Why this strategy?

This approach is predictable and simple to reason about.  
PixelSync does not include client-side editing, offline modifications, or two-way merges. Because all meaningful operations flow through the API (upload, crop, export), the server naturally acts as the central coordinator. Using a server-priority model avoids ambiguity and ensures the state remains consistent after every sync.

#### Potential flaws and data-loss risks

While effective for a controlled demo environment, this strategy has tradeoffs:

- **Local edits or local-only files are not preserved.**  
  If the client maintained additional metadata or modified images locally, those changes would be discarded during sync.

- **No conflict resolution is performed.**  
  In systems where multiple clients modify data independently, "Server Always Wins" can override newer client changes.

- **Not suitable for collaborative, multi-device workflows.**  
  A real production system often requires timestamps, version vectors, or application-specific merge logic to prevent silent overwrites.

For this project’s scope and constraints, Server Always Wins is the simplest and safest model while still showcasing a realistic sync mechanism.

## Data flow

### Upload flow

1. User selects files
2. Frontend sends `multipart/form-data`
3. API writes files to storage
4. API analyzes the image with sharp
5. API inserts metadata into PostgreSQL
6. Gallery refreshes automatically

### Sync flow

1. User triggers sync
2. API loads all DB rows
3. API scans storage folder
4. API:
   - Inserts new rows
   - Flags missing files as corrupted
   - Heals previously corrupted rows
5. Returns summary to client

### Crop flow

1. User draws a region
2. Frontend submits normalized coordinates
3. API crops with sharp
4. New file is saved to storage
5. Inserted as a distinct image record

### Export flow

1. User selects multiple thumbnails
2. Chooses export folder
3. Main process copies files to destination
4. Log panel shows export summary

## Running the project

### Requirements

- Node 18+
- npm
- Docker Desktop
- Git

### Start PostgreSQL with Docker

Make sure **Docker Desktop is running** before starting the database container.

From the project root:

```bash
docker compose up -d
```

### Run the API server

```bash
cd server/api
npm install
npm run dev
```

API default URL:  
`http://localhost:4000`

### Run the Electron app

```bash
cd app
npm install
npm run dev

```

## API reference

### `GET /health`

DB + API health check.

### `GET /images`

Returns list of image metadata.

### `GET /files/:id`

Streams raw image file.

### `POST /upload`

Single file upload.

### `POST /upload/batch`

Batch upload with summary.

### `POST /sync`

Runs manual sync cycle.

### `POST /images/:id/crop`

Crops a region of an existing image and creates a new one.

## Implementation notes and tradeoffs

- Server priority model simplifies conflict handling
- No destructive sync actions
- Corrupted files remain visible in gallery
- Sync is intentionally manual to prevent unexpected changes

## Future improvements

- Automatic background sync
- Conflict-aware merge strategy
- Image tagging, searching, and sorting
- Pagination for large sets
- Installer packaging for Electron
