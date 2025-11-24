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

## Minimal Frontend for Testing
A static client lives under `frontend/` to exercise every endpoint (flows, images, glows, promotes, chat, groups, SSE, etc.). Serve it with any static file server while the backend is running:

```powershell
# terminal 1
npm run dev

# terminal 2
npx http-server frontend -p 5174
# or: npx serve frontend -l 5174
```

Open `http://localhost:5174`, update the base URL field if necessary, and start triggering actions.

## Walrus (real mode)
Set `WALRUS_MODE=real` when you want to store blobs on the Walrus network instead of the mock file store. The backend mirrors the `writeFilesFlow` steps from the Walrus SDK (encode → register → upload → certify) using its own signer, so clients can keep calling the same REST endpoints.

Required env values:
- `SUI_NETWORK` / `SUI_RPC_URL` — RPC the backend will use for Walrus + Sui transactions
- `WALRUS_PRIVATE_KEY` (or reuse `SUI_PRIVATE_KEY`) — funds the register/certify steps
- `WALRUS_EPOCHS`, `WALRUS_DELETABLE`, `WALRUS_OWNER_ADDRESS` — storage policy for blobs
- Optional `WALRUS_UPLOAD_RELAY_HOST` and `WALRUS_UPLOAD_TIP_MAX` to fan-out uploads via a relay

With `CHAIN_MODE=walrus` the action log itself is also persisted in Walrus, so you can verify flows without deploying a dedicated smart contract.

## API Endpoints
- `GET /health` - Health check
- `POST /flows` - Create post (text or image)
- `GET /flows` - List posts
- `POST /glows` - Like a post
- `POST /chat` - Send message
- `GET /events` - SSE event stream

See `postman_collection.json` for full API documentation.
