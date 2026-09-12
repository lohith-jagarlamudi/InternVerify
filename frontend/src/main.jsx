import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!file) return;

    const body = new FormData();
    body.append('file', file);
    setMessage('Uploading…');

    try {
      const response = await fetch('http://localhost:8000/api/certificates/upload', {
        method: 'POST',
        body,
      });
      const result = await response.json();
      setMessage(`Received: ${result.filename}`);
    } catch {
      setMessage('Upload failed. Is the API running on port 8000?');
    }
  }

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">College internship operations</p>
        <h1>InternVerify</h1>
        <p className="intro">Upload internship certificates and prepare them for automated verification.</p>
      </header>
      <section className="panel">
        <h2>Upload a certificate</h2>
        <form onSubmit={submit}>
          <input type="file" accept="application/pdf,image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <button type="submit" disabled={!file}>Upload certificate</button>
        </form>
        {message && <p className="message" role="status">{message}</p>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
