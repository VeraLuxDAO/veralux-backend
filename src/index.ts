import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import socialRoutes from './routes/social.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'veralux-backend', env: process.env.SUI_NETWORK || 'testnet' }));
app.use('/', socialRoutes);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
