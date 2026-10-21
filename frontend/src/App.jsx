import { useEffect, useState } from 'react';
import axios from 'axios';

function App() {
  const [status, setStatus] = useState('Проверка сервера...');

  useEffect(() => {
    axios
      .get('/api/health')
      .then((response) => {
        setStatus(response.data.status);
      })
      .catch(() => {
        setStatus('Ошибка подключения');
      });
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">
          Smurf Tracker
        </h1>

        <p className="mt-4 text-slate-400">
          Backend status:
          {' '}
          <span className="text-green-400">
            {status}
          </span>
        </p>
      </div>
    </main>
  );
}

export default App;