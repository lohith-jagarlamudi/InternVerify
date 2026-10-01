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
};

function App() {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState(null);
  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [history, setHistory] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [previewRecord, setPreviewRecord] = useState(null);
  const [activeSection, setActiveSection] = useState('upload');
  const [uploading, setUploading] = useState(false);

  function exportHistory() {
    const rows = history.map(item => ({ filename: item.filename || '', student_name: item.student_name || '', certificate_id: item.certificate_id || '', status: item.status || '', verified_at: item.verified_at || '' }));
    const header = ['filename','student_name','certificate_id','status','verified_at'];
    const csv = [header, ...rows.map(row => header.map(key => `"${String(row[key]).replaceAll('"','""')}"`))].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'certify.co-history.csv'; link.click();
    URL.revokeObjectURL(url);
  }

  async function saveReview(item) {
    const notes = reviewNotes.trim();
    if (!notes) {
      setMessage('Review remarks are mandatory before marking a certificate as reviewed.');
      return;
    }
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

  async function verifyCertificate(certificateId) {
    if (!certificateId) return;
    setVerifying(true);
    setVerification(null);
    setMessage('');

    try {
      const response = await fetch(`http://localhost:8000/api/certificates/${certificateId}/verify`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Verification failed');
      setVerification(result);
      setDetails(previous => ({
        ...previous,
        browser_text: result.browser_text || '',
        browser_fields: result.browser_fields || {},
        match_report: result.match_report || {},
      }));
      loadHistory();
    } catch (error) {
      setVerification({ status: 'verification_unavailable', message: error.message, match_report: { items: [] } });
    } finally {
      setVerifying(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!file || uploading) return;

    const body = new FormData();
    body.append('file', file);
    setUploading(true);
    setMessage('');
    setDetails(null);
    setVerification(null);
    setActiveSection('results');

    try {
      const response = await fetch('http://localhost:8000/api/certificates/upload', {
        method: 'POST',
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Upload failed');
      setDetails(result);
      loadHistory();

      // Verification is automatic. The user only needs to choose the file and
      // click Upload certificate once; no second verification action is needed.
      if (result.certificate_id) {
        await verifyCertificate(result.certificate_id);
      }
    } catch (error) {
      setMessage(error.message || 'Upload failed. Is the API running on port 8000?');
      setActiveSection('upload');
    } finally {
      setUploading(false);
    }
  }

  const extractedFields = details?.extracted_fields || {};

  // Keep comparison rows consistently ordered by user priority:
  // 1) mismatches first, 2) matched fields, 3) unavailable/other fields.
  // Stable ordering within each group preserves the original field order.
  function sortComparisonItems(items) {
    const priority = (item) => item?.matched === false ? 0 : item?.matched === true ? 1 : 2;
    return [...(items || [])]
      .map((item, index) => ({ item, index }))
      .sort((a, b) => priority(a.item) - priority(b.item) || a.index - b.index)
      .map(({ item }) => item);
  }

  function historyMatchItems(item) {
    if (!item) return [];
    try {
      const parsed = typeof item.match_report_json === 'string' ? JSON.parse(item.match_report_json) : item.match_report_json;
      return sortComparisonItems(parsed?.items || []);
    } catch {
      return [];
    }
  }

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

  const verificationStatus = verification?.status || (verifying ? 'verifying' : details ? 'needs_review' : null);
  const statusMeta = {
    verified: { label: 'Verified', className: 'verified' },
    valid: { label: 'Verified', className: 'verified' },
    needs_review: { label: 'Needs review', className: 'needs_review' },
    verification_unavailable: { label: 'Needs review', className: 'needs_review' },
    not_verified: { label: 'Not verified', className: 'not_verified' },
    almost: { label: 'Verified', className: 'verified' },
    invalid: { label: 'Not verified', className: 'not_verified' },
    verifying: { label: 'Verifying…', className: 'verifying' },
  }[verificationStatus] || { label: 'Verifying…', className: 'verifying' };

  const comparisonItems = sortComparisonItems(verification?.match_report?.items || details?.match_report?.items || []);

  function renderComparison(items) {
    if (!items.length) {
      if (verifying) return <div className="comparison-loading" aria-live="polite">Checking certificate details…</div>;
      return <div className="comparison-empty">No comparable fields were found.</div>;
    }
    return (
      <div className="match-report" aria-label="Certificate field comparison">
        {items.map(item => (
          <div className="match-row" key={item.field}>
            <div className="match-field">
              <strong>{item.label || fieldLabels[item.field] || item.field}</strong>
              <div className="comparison-values">
                <div><span>Certificate</span><b>{item.uploaded ?? 'Not enough data to compare'}</b></div>
                <div><span>Verification page</span><b>{item.verification_page ?? 'Not enough data to compare'}</b></div>
              </div>
            </div>
            <span className={item.matched === true ? 'match-ok' : item.matched === false ? 'match-bad' : 'match-missing'}>
              {item.matched === null ? 'Not enough data to compare' : item.matched ? '✓ Matched' : '✕ Does not match'}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <main className="shell">
      <header className="app-header">
        <div className="brand-row"><div className="brand-mark">✓</div><h1>Certify.co</h1></div>
      </header>

      <nav className="quick-nav" aria-label="Main menu">
        <span className="quick-nav-label">Main menu</span>
        <button className={activeSection === 'upload' ? 'active' : ''} type="button" onClick={() => setActiveSection('upload')}>↥ Upload</button>
        {details && <button className={activeSection === 'results' ? 'active' : ''} type="button" onClick={() => setActiveSection('results')}>▣ Results</button>}
        <button className={activeSection === 'overview' ? 'active' : ''} type="button" onClick={() => { setActiveSection('overview'); loadHistory(); }}>◈ Overview</button>
        <button className={activeSection === 'history' ? 'active' : ''} type="button" onClick={() => { setActiveSection('history'); loadHistory(); }}>▤ History</button>
        {previewRecord && <button className={activeSection === 'preview' ? 'active' : ''} type="button" onClick={() => setActiveSection('preview')}>▣ Preview</button>}
        {comparison && <button className={activeSection === 'comparison' ? 'active' : ''} type="button" onClick={() => setActiveSection('comparison')}>⇄ Compare</button>}
      </nav>

      <section id="upload" className={`panel upload-panel ${activeSection === 'upload' || activeSection === 'results' ? 'view-active' : 'view-hidden'}`}>
        <div className="upload-heading"><div><span className="mini-label">Start here</span><h2>Upload a certificate</h2><p className="muted">Choose a PDF or image to begin verification.</p></div><span className="upload-icon">↥</span></div>
        <form onSubmit={submit}>
          <input type="file" accept="application/pdf,image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={uploading || verifying} />
          <button type="submit" disabled={!file || uploading || verifying}>{uploading ? 'Processing…' : 'Upload certificate'}</button>
        </form>
        {message && <p className="message" role="status">{message}</p>}

        {details && (
          <div id="results" className="result clean-result" aria-live="polite">
            <div className="result-header">
              <div>
                <span className="mini-label">Verification result</span>
                <h3>{verifying ? 'Checking certificate' : 'Certificate verification'}</h3>
              </div>
              <span className={`decision-pill ${statusMeta.className}`}>{statusMeta.label}</span>
            </div>

            {details.duplicate && !verifying && <div className="duplicate-note">Duplicate upload detected.</div>}

            {renderComparison(comparisonItems)}
          </div>
        )}
      </section>

      <section id="overview" className={`panel overview-panel ${activeSection === 'overview' ? 'view-active' : 'view-hidden'}`}>
        <div className="section-heading"><div><h2>Overview</h2><p className="muted">Verification activity summary.</p></div></div>
        <div className="summary-grid">
          <div className="summary-card total"><span>Total</span><strong>{historySummary.total}</strong></div>
          <div className="summary-card verified"><span>Verified</span><strong>{historySummary.verified}</strong></div>
          <div className="summary-card review"><span>Needs review</span><strong>{historySummary.needsReview}</strong></div>
          <div className="summary-card invalid"><span>Not verified</span><strong>{historySummary.notVerified}</strong></div>
          <div className="summary-card review-pending"><span>Pending faculty review</span><strong>{historySummary.pendingFacultyReview}</strong></div>
          <div className="summary-card duplicate-card"><span>Duplicate uploads</span><strong>{historySummary.duplicates}</strong></div>
        </div>
      </section>

      <section id="history" className={`panel history-panel ${activeSection === 'history' ? 'view-active' : 'view-hidden'}`}>
        <div className="section-heading">
          <div><h2>Verification history</h2><p className="muted">Recent certificates processed by faculty.</p></div>
          <div className="section-actions"><button type="button" onClick={exportHistory} disabled={!history.length}>Export CSV</button></div>
        </div>
        <div className="history-list">
          <div className="history-controls">
            <input aria-label="Search verification history" placeholder="Search student or certificate ID…" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
            <select aria-label="Filter verification status" value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="verified">Verified</option>
              <option value="needs_review">Needs review</option>
              <option value="not_verified">Not verified</option>
              <option value="duplicate">Duplicates</option>
            </select>
          </div>
          {history.filter(item => {
            const haystack = `${item.filename || ''} ${item.student_name || ''} ${item.certificate_id || ''}`.toLowerCase();
            const status = String(item.status || '').toLowerCase();
            const matchesFilter = historyFilter === 'all' || (historyFilter === 'duplicate' ? isDuplicate(item) : status === historyFilter);
            return haystack.includes(historySearch.toLowerCase()) && matchesFilter;
          }).map(item => <div className="history-record" key={item.certificate_id}>
            <button type="button" className="history-item" onClick={() => { const next = selectedHistory?.certificate_id === item.certificate_id ? null : item; setSelectedHistory(next); setReviewNotes(next?.review_notes || ''); }} aria-expanded={selectedHistory?.certificate_id === item.certificate_id}>
              <div><strong>{item.filename}</strong><span>{item.student_name || 'Student not detected'}</span><small>{new Date(item.verified_at).toLocaleString()}</small></div>
              <div className="history-item-badges"><span className={`status ${item.status}`}>{String(item.status).replaceAll('_', ' ')}</span></div>
            </button>
            {selectedHistory?.certificate_id === item.certificate_id && <div className="history-detail">
              <div className="detail-heading"><div><span className="mini-label">Certificate record</span><h3>Verification report</h3></div></div>
              <p><strong>Student name:</strong> {item.student_name || 'Not detected'}</p>
              <p><strong>Issue date:</strong> {item.issue_date || 'Not detected'}</p>
              <p><strong>Status:</strong> {String(item.status || '').replaceAll('_', ' ')}</p>
              <p><strong>Verified at:</strong> {item.verified_at ? new Date(item.verified_at).toLocaleString() : 'Not detected'}</p>
              <div className="detail-actions preview-actions"><button className="secondary-button" type="button" onClick={() => { setPreviewRecord(item); setActiveSection('preview'); }}>▣ Preview certificate</button></div>
              <div className="review-workspace"><div className="review-workspace-title"><span>Faculty review</span><small>{item.reviewed ? 'This record has been reviewed.' : 'Add a note before completing your review.'}</small></div><label htmlFor={`review-${item.certificate_id}`}>Review remarks <span className="required-mark">*</span></label><textarea id={`review-${item.certificate_id}`} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Enter the reason for your manual verification…" rows="3" required aria-required="true" /><div className="detail-actions">{isDuplicate(item) && <button className="secondary-button" type="button" onClick={() => compareRecord(item)}>⇄ Compare duplicate</button>}<button type="button" onClick={() => saveReview(item)} disabled={reviewSaving}>{reviewSaving ? 'Saving…' : item.reviewed ? '✓ Save review changes' : '✓ Mark as reviewed'}</button></div></div>
            </div>}
          </div>)}
          {!history.filter(item => {
            const haystack = `${item.filename || ''} ${item.student_name || ''} ${item.certificate_id || ''}`.toLowerCase();
            const status = String(item.status || '').toLowerCase();
            const matchesFilter = historyFilter === 'all' || (historyFilter === 'duplicate' ? isDuplicate(item) : status === historyFilter);
            return haystack.includes(historySearch.toLowerCase()) && matchesFilter;
          }).length && <p className="muted">No matching verification records.</p>}
        </div>
      </section>

      {previewRecord && <section id="preview" className={`panel preview-panel ${activeSection === 'preview' ? 'view-active' : 'view-hidden'}`}>
        <div className="section-heading"><div><span className="mini-label">Document viewer</span><h2>Certificate preview</h2><p className="muted">Compare the certificate text with the verification page.</p></div><button type="button" onClick={() => { setPreviewRecord(null); setActiveSection('history'); }}>Back to history</button></div>
        <div className="preview-split">
          <div className="preview-frame">
            {String(previewRecord.filename || '').toLowerCase().endsWith('.pdf') ? <iframe title="Certificate preview" src={`http://localhost:8000/api/certificates/${previewRecord.certificate_id}/file`} /> : <img alt={`Preview of ${previewRecord.filename || 'certificate'}`} src={`http://localhost:8000/api/certificates/${previewRecord.certificate_id}/file`} />}
          </div>
          <div className="preview-text-panel">
            <span className="mini-label">Field comparison</span>
            <h3>Certificate vs verification page</h3>
            <p className="preview-help">Only the fields used for verification are shown below, so the source of a mismatch is immediately visible.</p>
            {historyMatchItems(previewRecord).length ? (
              <div className="preview-match-report">
                {historyMatchItems(previewRecord).map(item => (
                  <div className="preview-match-row" key={item.field}>
                    <div className="preview-match-field">
                      <strong>{item.label || fieldLabels[item.field] || item.field}</strong>
                      <div className="preview-comparison-values">
                        <div><span>Certificate</span><b>{item.uploaded ?? 'Not enough data to compare'}</b></div>
                        <div><span>Verification page</span><b>{item.verification_page ?? 'Not enough data to compare'}</b></div>
                      </div>
                    </div>
                    <span className={item.matched === true ? 'match-ok' : item.matched === false ? 'match-bad' : 'match-missing'}>
                      {item.matched === null ? 'Not enough data to compare' : item.matched ? '✓ Matched' : '✕ Does not match'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="comparison-empty">No stored field comparison is available for this record.</div>
            )}
          </div>
        </div>
      </section>}

      {comparison && <section id="comparison" className={`panel comparison-panel ${activeSection === 'comparison' ? 'view-active' : 'view-hidden'}`}>
        <h2>Certificate comparison</h2>
        <button type="button" onClick={() => setComparison(null)}>Close comparison</button>
        <div className="comparison-grid">
          <div><h3>Selected upload</h3><p><strong>Filename:</strong> {comparison.current.filename || 'Not detected'}</p><p><strong>Student:</strong> {comparison.current.student_name || 'Not detected'}</p><p><strong>Issue date:</strong> {comparison.current.issue_date || 'Not detected'}</p><p><strong>Status:</strong> {comparison.current.status}</p></div>
          <div><h3>Previous matching upload</h3>{comparison.matches.length ? comparison.matches.map(match => <div key={match.certificate_id}><p><strong>Filename:</strong> {match.filename || 'Not detected'}</p><p><strong>Student:</strong> {match.student_name || 'Not detected'}</p><p><strong>Issue date:</strong> {match.issue_date || 'Not detected'}</p><p><strong>Status:</strong> {match.status}</p></div>) : <p className="muted">No previous matching record found.</p>}</div>
        </div>
      </section>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);