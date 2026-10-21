import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import playersRouter from './routes/players.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok'
  });
});

app.use('/api/players', playersRouter);

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});