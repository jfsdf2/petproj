import axios from 'axios';

const opendota = axios.create({
  baseURL: 'https://api.opendota.com/api',
  timeout: 10000
});

export async function getPlayer(accountId) {
  const response = await opendota.get(`/players/${accountId}`);

  return response.data;
}