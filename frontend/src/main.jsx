import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const fieldLabels = {
  student_name: 'Student name',
  company_name: 'Company name',
  internship_role: 'Internship role',
  start_date: 'Start date',
  end_date: 'End date',
  certificate_number: 'Certificate number',
  duration: 'Duration',
  issue_date: 'Issue date',
  verification_url: 'Verification URL',
};

function App() {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState(null);
  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [previewRecord, setPreviewRecord] = useState(null);
  const [activeSection, setActiveSection] = useState('upload');

  function exportHistory() {
    const rows = history.map(item => ({ filename: item.filename || '', student_name: item.student_name || '', certificate_id: item.certificate_id || '', status: item.status || '', verified_at: item.verified_at || '' }));
    const header = ['filename','student_name','certificate_id','status','verified_at'];
    const csv = [header, ...rows.map(row => header.map(key => `\"${String(row[key]).replaceAll('\"','\"\"')}\"`))].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'internverify-history.csv'; link.click();
    URL.revokeObjectURL(url);
  }

  async function saveReview(item) {
    setReviewSaving(true);
    try {
      const response = await fetch(`http://localhost:8000/api/history/${item.certificate_id}/review`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({review_notes: reviewNotes, reviewed: true}) });
      if (!response.ok) throw new Error('Could not save review');
      setMessage('Review notes saved.');
      loadHistory();
    } catch (error) { setMessage(error.message); } finally { setReviewSaving(false); }
  }

  async function compareRecord(item) {
    try {
      const response = await fetch(`http://localhost:8000/api/history/${item.certificate_id}/duplicates`);
      const result = await response.json();
      setComparison({ current: item, matches: result.items || [] });
      setActiveSection('comparison');
    } catch { setMessage('Could not load duplicate comparison.'); }
  }

  async function loadHistory() {
    try {
      const response = await fetch('http://localhost:8000/api/history');
      const result = await response.json();
      setHistory(result.items || []);
    } catch { setMessage('Could not load verification history.'); }
  }

  async function submit(event) {
    event.preventDefault();
    if (!file) return;

    const body = new FormData();
    body.append('file', file);
    setMessage('Uploading certificate and searching for QR codes or verification links…');
    setDetails(null);
    setVerification(null);

    try {
      const response = await fetch('http://localhost:8000/api/certificates/upload', {
        method: 'POST',
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Upload failed');
      setMessage(`Received: ${result.filename}`);
      setDetails(result);
      setActiveSection('results');
      loadHistory();
    } catch (error) {
      setMessage(error.message || 'Upload failed. Is the API running on port 8000?');
    }
  }

  async function verifyCertificate() {
    if (!details?.certificate_id) return;
    setVerifying(true);
    setVerification(null);

    try {
      const response = await fetch(`http://localhost:8000/api/certificates/${details.certificate_id}/verify`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Verification failed');
      setVerification(result);
      setDetails(previous => ({ ...previous, browser_text: result.browser_text || '', browser_fields: result.browser_fields || {}, match_report: result.match_report || {} }));
      setMessage(result.message || 'Verification completed.');
      loadHistory();
    } catch (error) {
      setVerification({ status: 'verification_unavailable', message: error.message });
    } finally {
      setVerifying(false);
    }
  }

  const sources = details?.verification_sources || [];
  const canVerify = sources.length > 0;
  const extractedFields = details?.extracted_fields || {};
  const detectedFields = Object.entries(fieldLabels).filter(([key]) => {
    const value = extractedFields[key];
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
  const notDetectedFields = Object.entries(fieldLabels).filter(([key]) => !detectedFields.some(([detectedKey]) => detectedKey === key));

  const isDuplicate = (item) => Boolean(item.duplicate) || String(item.message || '').toLowerCase().includes('duplicate');

  const historySummary = {
    total: history.length,
    verified: history.filter(item => ['verified', 'valid', 'almost'].includes(String(item.status || '').toLowerCase())).length,
    needsReview: history.filter(item => ['needs_review', 'verification_unavailable'].includes(String(item.status || '').toLowerCase())).length,
    notVerified: history.filter(item => ['not_verified', 'invalid', 'verification_failed'].includes(String(item.status || '').toLowerCase())).length,
    almost: 0,
    pendingFacultyReview: history.filter(item => !item.reviewed).length,
    duplicates: history.filter(isDuplicate).length,
  };

  const verificationStatus = verification?.status || (details ? 'needs_review' : null);
  const statusMeta = {
    verified: { label: 'Verified', className: 'verified', message: 'The certificate verification request completed successfully.' },
    valid: { label: 'Verified', className: 'verified', message: 'The certificate verification request completed successfully.' },
    needs_review: { label: 'Needs review', className: 'needs_review', message: 'The certificate needs manual review before it can be accepted.' },
    verification_unavailable: { label: 'Needs review', className: 'needs_review', message: 'Automatic verification was unavailable. Please review the certificate manually.' },
    not_verified: { label: 'Not verified', className: 'not_verified', message: 'The certificate details do not match the verification page.' },
    almost: { label: 'Verified', className: 'verified', message: 'All available mapped fields matched exactly.' },
    invalid: { label: 'Not verified', className: 'not_verified', message: 'The certificate could not be verified.' },
  }[verificationStatus] || { label: 'Needs review', className: 'needs_review', message: 'Verification is not complete yet.' };

  return (
    <main className="shell">
      <header className="app-header">
        <div className="brand-row"><div className="brand-mark">✓</div><h1>InternVerify</h1></div>
      </header>
      <nav className="quick-nav" aria-label="Main menu">
        <span className="quick-nav-label">Main menu</span>
        <button className={activeSection === 'upload' ? 'active' : ''} type="button" onClick={() => setActiveSection('upload')}>↥ Upload</button>
        {details && <button className={activeSection === 'results' ? 'active' : ''} type="button" onClick={() => setActiveSection('results')}>▣ Results</button>}
        <button className={activeSection === 'overview' ? 'active' : ''} type="button" onClick={() => { setActiveSection('overview'); loadHistory(); }}>◈ Overview</button>
        <button className={activeSection === 'history' ? 'active' : ''} type="button" onClick={() => { setActiveSection('history'); setShowHistory(true); loadHistory(); }}>▤ History</button>
        {previewRecord && <button className={activeSection === 'preview' ? 'active' : ''} type="button" onClick={() => setActiveSection('preview')}>▣ Preview</button>}
        {comparison && <button className={activeSection === 'comparison' ? 'active' : ''} type="button" onClick={() => setActiveSection('comparison')}>⇄ Compare</button>}
      </nav>
      <section id="upload" className={`panel upload-panel ${activeSection === 'upload' || activeSection === 'results' ? 'view-active' : 'view-hidden'}`}>
        <div className="upload-heading"><div><span className="mini-label">Start here</span><h2>Upload a certificate</h2><p className="muted">Choose a PDF or image to begin verification.</p></div><span className="upload-icon">↥</span></div>
        <form onSubmit={submit}>
          <input type="file" accept="application/pdf,image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <button type="submit" disabled={!file}>Upload certificate</button>
        </form>
        {message && <p className="message" role="status">{message}</p>}
        {details && (
          <div id="results" className="result" aria-live="polite">
            <h3>Certificate processing</h3>
            {details.duplicate && <div className="decision-banner needs_review"><strong>Duplicate certificate detected</strong><span>This file matches a certificate already processed in history.</span></div>}
            <div className={`decision-banner ${statusMeta.className}`}>
              <span className="decision-label">{statusMeta.label}</span>
              <span>{statusMeta.message}</span>
            </div>
            <p><strong>Processing status:</strong> <span className={`status ${details.status}`}>{String(details.status || '').replaceAll('_', ' ')}</span></p>
            <p><strong>Certificate ID:</strong> {details.certificate_id}</p>
            <p><strong>File size:</strong> {details.size_bytes} bytes</p>
            <p><strong>Extraction status:</strong> {details.next_step}</p>
            <p><strong>Note:</strong> {details.extraction_note}</p>

            <h3>Verification source</h3>
            {sources.length ? (
              <>
                <p className="success-note">A QR code or verification link was detected.</p>
                <ul className="source-list">
                  {sources.map((source, index) => (
                    <li key={`${source.url}-${index}`}>
                      <strong>{source.source_type === 'qr' ? 'QR code' : 'Printed link'}{source.page ? ` — page ${source.page}` : ''}</strong>
                      <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={verifyCertificate} disabled={verifying}>
                  {verifying ? 'Verifying certificate…' : 'Verify certificate'}
                </button>
              {verification?.browser_text && <details className="browser-text-details" open><summary>Verification browser output</summary><pre className="text-preview">{verification.browser_text}</pre></details>}
              {verification?.match_report?.items?.length > 0 && <div className="match-report"><h4>Certificate field comparison</h4>{verification.match_report.items.map(item => <div className="match-row" key={item.field}><div><strong>{item.label}</strong><small>Certificate: {item.uploaded ?? 'Not enough data to compare'}</small><small>Verification page: {item.verification_page ?? 'Not enough data to compare'}</small></div><span className={item.matched === true ? 'match-ok' : item.matched === false ? 'match-bad' : 'match-missing'}>{item.matched === null ? 'Not enough data to compare' : item.matched ? '✓ Matched' : '✕ Does not match'}</span></div>)}</div>}
              </>
            ) : (
              <p className="review-warning">No QR code or verification link was detected. This certificate cannot be automatically verified yet.</p>
            )}

            {verification && (
              <div className="verification-result">
                <h3>Verification result</h3>
                <p><strong>Status:</strong> <span className={`status ${statusMeta.className}`}>{statusMeta.label}</span></p>
                {verification.message && <p>{verification.message}</p>}
                {verification.url && <p><strong>Checked URL:</strong> <a href={verification.url} target="_blank" rel="noreferrer">{verification.url}</a></p>}
                {verification.http_status && <p><strong>HTTP status:</strong> {verification.http_status}</p>}
              </div>
            )}

            {details.extracted_fields && (
              <section className="extracted-section">
                <h3>Extracted certificate details</h3>
                {detectedFields.length ? (
                  <div className="fields detected-fields">
                    {detectedFields.map(([key, label]) => (
                      <p key={key}><strong>{label}:</strong> {extractedFields[key]}</p>
                    ))}
                  </div>
                ) : (
                  <p className="review-warning">No certificate fields were detected.</p>
                )}

                {notDetectedFields.length > 0 && (
                  <details className="secondary-details">
                    <summary>Not detected ({notDetectedFields.length} fields)</summary>
                    <div className="fields">
                      {notDetectedFields.map(([key, label]) => (
                        <p key={key}><strong>{label}:</strong> Not detected</p>
                      ))}
                    </div>
                  </details>
                )}
              </section>
            )}

            {details.full_text && (
              <details className="raw-text">
                <summary>Show complete extracted text</summary>
                <pre className="text-preview">{details.full_text}</pre>
              </details>
            )}
          </div>
        )}
      </section>
      <section id="overview" className={`panel dashboard-panel ${activeSection === 'overview' ? 'view-active' : 'view-hidden'}`}>
        <div className="section-heading"><div><h2>Verification overview</h2><p className="muted">Summary of certificates processed by faculty.</p></div><button type="button" onClick={() => { setShowHistory(true); loadHistory(); }}>Refresh summary</button></div>
        <div className="summary-grid">
          <div className="summary-card"><span>Total certificates</span><strong>{historySummary.total}</strong></div>
          <div className="summary-card verified"><span>Verified</span><strong>{historySummary.verified}</strong></div>
          <div className="summary-card needs_review"><span>Needs review</span><strong>{historySummary.needsReview}</strong></div>
          <div className="summary-card not_verified"><span>Not verified</span><strong>{historySummary.notVerified}</strong></div>
          <div className="summary-card almost"><span>Almost</span><strong>{historySummary.almost}</strong></div>
          <div className="summary-card review-pending"><span>Pending faculty review</span><strong>{historySummary.pendingFacultyReview}</strong></div>
          <div className="summary-card duplicate-card"><span>Duplicate uploads</span><strong>{historySummary.duplicates}</strong></div>
        </div>
      </section>
      <section id="history" className={`panel history-panel ${activeSection === 'history' ? 'view-active' : 'view-hidden'}`}>
        <div className="section-heading">
          <div><h2>Verification history</h2><p className="muted">Recent certificates processed by faculty.</p></div>
          <div className="section-actions"><button type="button" onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}>{showHistory ? 'Hide history' : 'View history'}</button>{showHistory && <button type="button" onClick={exportHistory} disabled={!history.length}>Export CSV</button>}</div>
        </div>
        {showHistory && <div className="history-list">
          <div className="history-controls">
            <input aria-label="Search verification history" placeholder="Search student or certificate ID…" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
            <select aria-label="Filter verification status" value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="verified">Verified</option>
              <option value="needs_review">Needs review</option>
              <option value="almost">Almost</option>
              <option value="not_verified">Not verified</option>
              <option value="duplicate">Duplicates</option>
            </select>
          </div>
          {history.filter(item => {
            const haystack = `${item.filename || ''} ${item.student_name || ''} ${item.certificate_id || ''}`.toLowerCase();
            const status = String(item.status || '').toLowerCase();
            const matchesFilter = historyFilter === 'all' || (historyFilter === 'duplicate' ? isDuplicate(item) : status === historyFilter);
            return haystack.includes(historySearch.toLowerCase()) && matchesFilter;
          }).length ? history.filter(item => {
            const haystack = `${item.filename || ''} ${item.student_name || ''} ${item.certificate_id || ''}`.toLowerCase();
            const status = String(item.status || '').toLowerCase();
            const matchesFilter = historyFilter === 'all' || (historyFilter === 'duplicate' ? isDuplicate(item) : status === historyFilter);
            return haystack.includes(historySearch.toLowerCase()) && matchesFilter;
          }).map(item => <div className="history-record" key={item.certificate_id}>
            <button type="button" className="history-item" onClick={() => { const next = selectedHistory?.certificate_id === item.certificate_id ? null : item; setSelectedHistory(next); setReviewNotes(next?.review_notes || ''); }} aria-expanded={selectedHistory?.certificate_id === item.certificate_id}>
              <div><strong>{item.filename}</strong><span>{item.student_name || 'Student not detected'}</span><small>Certificate ID: {item.certificate_id}</small><small>{new Date(item.verified_at).toLocaleString()}</small></div>
              <div className="history-item-badges"><span className={`status ${item.status}`}>{String(item.status).replaceAll('_', ' ')}</span><span className={`review-badge compact ${item.reviewed ? 'reviewed' : 'pending'}`}>{item.reviewed ? '✓ Reviewed' : 'Pending review'}</span></div>
            </button>
            {selectedHistory?.certificate_id === item.certificate_id && <div className="history-detail">
              <div className="detail-heading"><div><span className="mini-label">Certificate record</span><h3>Verification report</h3></div><span className={`review-badge ${item.reviewed ? 'reviewed' : 'pending'}`}>{item.reviewed ? '✓ Reviewed' : '◷ Pending review'}</span></div>
              <p><strong>Certificate ID:</strong> {item.certificate_id}</p>
              <p><strong>Filename:</strong> {item.filename || 'Not detected'}</p>
              <p><strong>Student name:</strong> {item.student_name || 'Not detected'}</p>
              <p><strong>Issue date:</strong> {item.issue_date || 'Not detected'}</p>
              <p><strong>Status:</strong> {String(item.status || '').replaceAll('_', ' ')}</p><p><strong>Reason:</strong> {item.reason || 'Not detected'}</p>
              <p><strong>Verification URL:</strong> {item.verification_url || 'Not detected'}</p>
              <p><strong>Message:</strong> {item.message || 'No additional message'}</p><p><strong>Reason:</strong> {item.reason || 'Not detected'}</p>
              <p><strong>Verified at:</strong> {item.verified_at ? new Date(item.verified_at).toLocaleString() : 'Not detected'}</p><div className="detail-actions preview-actions"><button className="secondary-button" type="button" onClick={() => { setPreviewRecord(item); setActiveSection('preview'); }}>▣ Preview certificate</button></div><div className="review-workspace"><div className="review-workspace-title"><span>Faculty review</span><small>{item.reviewed ? 'This record has been reviewed.' : 'Add a note before completing your review.'}</small></div><label htmlFor={`review-${item.certificate_id}`}>Review notes</label><textarea id={`review-${item.certificate_id}`} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="e.g. Confirmed name and date against the original certificate…" rows="3" /><div className="detail-actions">{isDuplicate(item) && <button className="secondary-button" type="button" onClick={() => compareRecord(item)}>⇄ Compare duplicate</button>}<button type="button" onClick={() => saveReview(item)} disabled={reviewSaving}>{reviewSaving ? 'Saving…' : item.reviewed ? '✓ Save review changes' : '✓ Mark as reviewed'}</button></div></div>
            </div>}
          </div>) : <p className="muted">No matching verification records.</p>}
        </div>}
      </section>
      {previewRecord && <section id="preview" className={`panel preview-panel ${activeSection === 'preview' ? 'view-active' : 'view-hidden'}`}>
        <div className="section-heading"><div><span className="mini-label">Document viewer</span><h2>Certificate preview</h2><p className="muted">Review the original uploaded document alongside the extracted details.</p></div><button type="button" onClick={() => setPreviewRecord(null)}>Close preview</button></div>
        <div className="preview-split">
          <div className="preview-frame">
            {String(previewRecord.filename || '').toLowerCase().endsWith('.pdf') ? <iframe title="Certificate preview" src={`http://localhost:8000/api/certificates/${previewRecord.certificate_id}/file`} /> : <img alt={`Preview of ${previewRecord.filename || 'certificate'}`} src={`http://localhost:8000/api/certificates/${previewRecord.certificate_id}/file`} />}
          </div>
          <div className="preview-text-panel">
            <span className="mini-label">Verification browser output</span>
            <h3>Extracted text</h3>
            {details && previewRecord.certificate_id === details.certificate_id ? (
              <>
                <div className="portrait-fields">{Object.entries(details.browser_fields || {}).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '').map(([key, value]) => <p key={key}><strong>{fieldLabels[key] || key}:</strong> {value}</p>)}</div>
                {!Object.keys(details.browser_fields || {}).length && <p className="muted">No structured fields were detected from the verification page.</p>}
                <details className="browser-text-details" open><summary>Verification browser extracted text</summary><pre className="text-preview">{details.browser_text || 'No verification-browser text available. Click Verify certificate first.'}</pre></details>
              </>
            ) : (
              <div className="portrait-fields"><p><strong>Student name:</strong> {previewRecord.student_name || 'Not detected'}</p><p><strong>Issue date:</strong> {previewRecord.issue_date || 'Not detected'}</p><p><strong>Certificate ID:</strong> {previewRecord.certificate_id || 'Not detected'}</p><p className="muted">Complete browser text is available immediately after the certificate is uploaded and verified.</p></div>
            )}
          </div>
        </div>
      </section>}
      {comparison && <section id="comparison" className={`panel comparison-panel ${activeSection === 'comparison' ? 'view-active' : 'view-hidden'}`}>
        <h2>Certificate comparison</h2>
        <button type="button" onClick={() => setComparison(null)}>Close comparison</button>
        <div className="comparison-grid">
          <div><h3>Selected upload</h3><p><strong>Filename:</strong> {comparison.current.filename || 'Not detected'}</p><p><strong>Student:</strong> {comparison.current.student_name || 'Not detected'}</p><p><strong>Issue date:</strong> {comparison.current.issue_date || 'Not detected'}</p><p><strong>Status:</strong> {comparison.current.status}</p><p><strong>Certificate ID:</strong> {comparison.current.certificate_id}</p></div>
          <div><h3>Previous matching upload</h3>{comparison.matches.length ? comparison.matches.map(match => <div key={match.certificate_id}><p><strong>Filename:</strong> {match.filename || 'Not detected'}</p><p><strong>Student:</strong> {match.student_name || 'Not detected'}</p><p><strong>Issue date:</strong> {match.issue_date || 'Not detected'}</p><p><strong>Status:</strong> {match.status}</p><p><strong>Certificate ID:</strong> {match.certificate_id}</p></div>) : <p className="muted">No previous matching record found.</p>}</div>
        </div>
      </section>}

    </main>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);