import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (!file) return;

    const body = new FormData();
    body.append('file', file);
    setMessage('Uploading…');
    setDetails(null);

    try {
      const response = await fetch('http://localhost:8000/api/certificates/upload', {
        method: 'POST',
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Upload failed');
      setMessage(`Received: ${result.filename}`);
      setDetails(result);
    } catch (error) {
      setMessage(error.message || 'Upload failed. Is the API running on port 8000?');
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
        {details && (
          <div className="result" aria-live="polite">
            <h3>Upload details</h3>
            <p><strong>Status:</strong> {details.status}</p>
            <p><strong>Certificate ID:</strong> {details.certificate_id}</p>
            <p><strong>File size:</strong> {details.size_bytes} bytes</p>
            <p><strong>Next step:</strong> {details.next_step}</p>
          </div>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
