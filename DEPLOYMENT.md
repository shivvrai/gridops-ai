# Deployment Guide

## Prerequisites
- Docker and Docker Compose (v2)
- 4GB RAM minimum (Postgres + Python backend + React frontend)
- Ports 3000, 5432, 8000 available

## One-Command Startup

```bash
docker compose up --build
```

This will:
1. Start Postgres (port 5432)
2. Build and start the FastAPI backend (port 8000)
3. Build and start the React frontend (port 3000)
4. Auto-seed the database with ~3,800 poles across 4 substations
5. Run topology inference for DTs with missing ordering
6. Start the 10-second fault detection sweep

### Services

| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://localhost:3000 | Operator Console |
| Backend API | http://localhost:8000 | REST + SSE API |
| API Docs | http://localhost:8000/docs | Swagger UI |
| Postgres | localhost:5432 | Database |

## AI Feature Setup

To enable AI-generated ticket explanations:

```bash
# Copy .env.example and set your key
cp .env.example .env
# Edit .env: set OPENAI_API_KEY=sk-...
docker compose up --build
```

Without the API key, the "Explain This Ticket" button falls back to a structured summary — the system is fully functional without it.

## Development Mode

```bash
# Backend (with hot reload)
cd backend
pip install -r requirements.txt
# Ensure Postgres is running on localhost:5432
DATABASE_URL=postgresql+asyncpg://faultloc:faultloc@localhost:5432/faultloc uvicorn app.main:app --reload --port 8000

# Frontend (with hot reload)
cd frontend
npm install
npm run dev
```

## Troubleshooting

### Port conflicts
```bash
# Check what's using a port
netstat -ano | findstr :8000  # Windows
lsof -i :8000                # Linux/Mac
```

### Database issues
```bash
# Reset database
docker compose down -v  # Deletes the pgdata volume
docker compose up --build
```

### Frontend can't reach backend
- In Docker: The nginx proxy routes `/api/` to `http://backend:8000`
- In development: The Vite proxy routes `/api/` to `http://localhost:8000`
- Check CORS: The backend allows all origins (`*`)

### SSE connection drops
- SSE reconnects automatically after 3 seconds
- The nginx config disables buffering (`proxy_buffering off`) for SSE compatibility
- Check the browser console for connection status

### Backend startup hangs
- Postgres health check may take up to 25 seconds
- The seed generator creates ~3,800 poles — this takes ~5 seconds
- Topology inference for ~250 inferred DTs takes ~3 seconds

## Cloud Deployment (Vercel + Backend)

This project has a **React (Vite) Frontend** and a **FastAPI (Python) Backend**.

### Architecture Overview
- **Frontend on Vercel**: Vercel provides world-class global edge CDN hosting for Vite Single Page Applications.
- **Backend on Render / Railway / Fly.io**: The backend requires long-lived state (in-memory topology graph, 10s background sweep loop, and Server-Sent Events). It runs best on a container host.

---

### Step 1: Deploy Backend (Render / Railway / Fly.io)

Using **Render** (Free tier available):
1. Create a free account at [render.com](https://render.com).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository.
4. Configure service settings:
   - **Name**: `faultloc-backend`
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Click **Deploy Web Service**.
6. Copy your public URL (e.g. `https://faultloc-backend.onrender.com`).

---

### Step 2: Deploy Frontend on Vercel

#### Method A: Via Vercel Web Dashboard (Recommended)
1. Push your latest code to GitHub:
   ```bash
   git add .
   git commit -m "Add industry features and Vercel config"
   git push origin main
   ```
2. Log in to [vercel.com](https://vercel.com) and click **"Add New..."** -> **"Project"**.
3. Import your GitHub repository.
4. In the **Configure Project** screen:
   - **Framework Preset**: `Vite`
   - **Root Directory**: Click *Edit* and select `frontend`
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `dist` (default)
5. Expand **Environment Variables**:
   - **Key**: `VITE_API_BASE_URL`
   - **Value**: `https://faultloc-backend.onrender.com` (your backend URL from Step 1)
6. Click **Deploy**.
   Your application will be live at `https://your-project.vercel.app`.

#### Method B: Via Vercel CLI
```bash
cd frontend
npm install -g vercel
vercel
```
When prompted:
- Set up and deploy: **Y**
- Which scope: *(your account)*
- Link to existing project: **N**
- Project name: `fault-localization-ui`
- In which directory is your code located: `./`
- Want to modify settings: **N**

Then set the environment variable:
```bash
vercel env add VITE_API_BASE_URL
# Enter your backend URL when prompted (e.g., https://faultloc-backend.onrender.com)
vercel --prod
```

---

## Running Tests

```bash
cd backend
python -m pytest tests/ -v
```

