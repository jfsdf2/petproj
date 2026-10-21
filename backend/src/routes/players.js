import express from 'express';
import { getPlayer } from '../services/opendota.js';

const router = express.Router();

router.get('/:steamId', async (req, res) => {
  try {
    const { steamId } = req.params;

    const player = await getPlayer(steamId);

    res.json(player);
  } catch (error) {
    console.error(error.message);

    res.status(500).json({
      message: 'Не удалось получить данные игрока'
    });
  }
});

export default router;