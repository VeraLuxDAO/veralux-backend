# YNX-backend

Social hub backend with content storage, Postgres database, and blockchain events.

## Prerequisites
- Node 18+
- PostgreSQL database

## Setup

1. **Install dependencies**
```powershell
npm install
```

2. **Configure environment**
```powershell
copy .env.example .env
```
Edit `.env` and set your `DATABASE_URL`:
```
DATABASE_URL="postgresql://user:password@localhost:5432/dbname"
```

3. **Run database migrations**
```powershell
npx prisma migrate dev
```

4. **Start the server**
```powershell
npm run dev
```

Server runs at `http://localhost:4000`

## API Endpoints
- `GET /health` - Health check
- `POST /flows` - Create post (text or image)
- `GET /flows` - List posts
- `POST /glows` - Like a post
- `POST /chat` - Send message
- `GET /events` - SSE event stream

See `postman_collection.json` for full API documentation.
