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

## Running Tests

```bash
cd backend
python -m pytest tests/ -v
```
