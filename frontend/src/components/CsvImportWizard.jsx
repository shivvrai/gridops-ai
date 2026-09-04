import { useState } from 'react'

const DATASETS = [
  {
    id: 'poles',
    label: 'Pole Registry',
    icon: '📍',
    description: 'Low-tension (LT) pole assets, coordinates, feeding DT & feeder, and IoT device mappings.',
    templateUrl: '/api/data/template/poles',
    templateName: 'poles_template.csv',
    requiredCols: ['pole_id', 'lat', 'lon', 'feeder_id', 'dt_id'],
    optionalCols: ['parent_pole_id', 'seq_on_line', 'device_id', 'pincode', 'ward', 'pole_type'],
  },
  {
    id: 'dts',
    label: 'Transformer Registry',
    icon: '⚡',
    description: 'Distribution transformers (11 kV step-down), capacity in kVA, households served.',
    templateUrl: '/api/data/template/dts',
    templateName: 'dts_template.csv',
    requiredCols: ['dt_id', 'feeder_id', 'lat', 'lon'],
    optionalCols: ['capacity_kva', 'households_served', 'has_surveyed_topology'],
  },
  {
    id: 'outages',
    label: 'Outage Schedule',
    icon: '📅',
    description: 'Planned load shedding and maintenance windows for false-alarm suppression.',
    templateUrl: '/api/data/template/outages',
    templateName: 'outages_template.csv',
    requiredCols: ['outage_id', 'scope', 'target_id', 'scheduled_start', 'scheduled_end'],
    optionalCols: ['reason'],
  },
]

function CsvImportWizard({ apiUrl, onRefreshNetwork, onMapPreviewData }) {
  const [currentStep, setCurrentStep] = useState(1) // 1: Select, 2: Upload, 3: Preview, 4: Rebuild
  const [selectedDataset, setSelectedDataset] = useState(DATASETS[0])
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [validationReport, setValidationReport] = useState(null)
  const [buildProgress, setBuildProgress] = useState(null)
  const [error, setError] = useState(null)

  const handleSelectDataset = (dataset) => {
    setSelectedDataset(dataset)
    setFile(null)
    setPreviewData(null)
    setValidationReport(null)
    setError(null)
    setCurrentStep(2)
  }

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0]
    if (!selectedFile) return
    setFile(selectedFile)
    setError(null)
    setUploading(true)

    try {
      // 1. Fetch preview and cell error analysis
      const previewForm = new FormData()
      previewForm.append('file', selectedFile)
      const previewRes = await fetch(`${apiUrl}/api/data/preview?entity=${selectedDataset.id === 'dts' ? 'dt' : selectedDataset.id === 'outages' ? 'outage' : 'pole'}`, {
        method: 'POST',
        body: previewForm,
      })

      if (!previewRes.ok) {
        const errData = await previewRes.json()
        throw new Error(errData.detail || 'Failed to inspect CSV')
      }

      const pData = await previewRes.json()
      setPreviewData(pData)

      // If poles or DTs, pass preview nodes to parent map preview
      if (onMapPreviewData && (selectedDataset.id === 'poles' || selectedDataset.id === 'dts')) {
        onMapPreviewData({
          type: selectedDataset.id,
          rows: pData.preview_rows,
        })
      }

      setCurrentStep(3)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleDownloadErrorReport = async () => {
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const entity = selectedDataset.id === 'dts' ? 'dt' : selectedDataset.id === 'outages' ? 'outage' : 'pole'
      const res = await fetch(`${apiUrl}/api/data/error-report?entity=${entity}`, {
        method: 'POST',
        body: formData,
      })
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selectedDataset.id}_error_report.csv`
      a.click()
    } catch (err) {
      setError('Failed to download error report')
    }
  }

  const handleConfirmImport = async () => {
    if (!file) return
    setBuildProgress('Importing and saving records...')
    setError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      // Step 1: Upload and save
      const uploadRes = await fetch(`${apiUrl}/api/data/upload/${selectedDataset.id}`, {
        method: 'POST',
        body: formData,
      })

      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) {
        throw new Error(uploadData.detail || 'Upload failed')
      }
      setValidationReport(uploadData)

      // Step 2: If poles or dts, rebuild network topology with simulated step progression
      if (selectedDataset.id === 'poles' || selectedDataset.id === 'dts') {
        setBuildProgress('Building network topology...')
        await new Promise(r => setTimeout(r, 600))

        setBuildProgress('Rebuilding localization engine...')
        const reloadRes = await fetch(`${apiUrl}/api/data/reload`, { method: 'POST' })
        const reloadData = await reloadRes.json()

        setBuildProgress('Refreshing map and active poles...')
        await new Promise(r => setTimeout(r, 400))

        setBuildProgress(`✓ Network successfully rebuilt: ${reloadData.poles} poles, ${reloadData.graph_nodes} nodes, ${reloadData.graph_edges} edges.`)
        if (onRefreshNetwork) onRefreshNetwork()
      } else {
        setBuildProgress(`✓ Outages schedule successfully imported: ${uploadData.saved_to_db} planned outages recorded.`)
      }

      setCurrentStep(4)
    } catch (err) {
      setError(err.message)
      setBuildProgress(null)
    }
  }

  const resetWizard = () => {
    setCurrentStep(1)
    setFile(null)
    setPreviewData(null)
    setValidationReport(null)
    setBuildProgress(null)
    setError(null)
    if (onMapPreviewData) onMapPreviewData(null)
  }

  return (
    <div className="wizard-container">
      {/* Wizard Progress Stepper */}
      <div className="wizard-stepper">
        <div className={`step-item ${currentStep >= 1 ? 'active' : ''}`}>1. Select Dataset</div>
        <div className="step-divider">→</div>
        <div className={`step-item ${currentStep >= 2 ? 'active' : ''}`}>2. Upload</div>
        <div className="step-divider">→</div>
        <div className={`step-item ${currentStep >= 3 ? 'active' : ''}`}>3. Validate & Preview</div>
        <div className="step-divider">→</div>
        <div className={`step-item ${currentStep >= 4 ? 'active' : ''}`}>4. Confirm & Rebuild</div>
      </div>

      {error && (
        <div className="wizard-error">
          <span>❌ Error:</span>
          <span>{error}</span>
        </div>
      )}

      {/* STEP 1: Select Dataset */}
      {currentStep === 1 && (
        <div className="wizard-step-content">
          <h4>Select Dataset to Import</h4>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Choose the registry dataset you want to upload or replace in the GridOps database.
          </p>
          <div className="dataset-grid">
            {DATASETS.map((d) => (
              <div
                key={d.id}
                className="dataset-card"
                onClick={() => handleSelectDataset(d)}
              >
                <div className="dataset-icon">{d.icon}</div>
                <div className="dataset-title">{d.label}</div>
                <div className="dataset-desc">{d.description}</div>
                <div className="dataset-required">
                  Required: {d.requiredCols.join(', ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 2: Upload File & Template */}
      {currentStep === 2 && (
        <div className="wizard-step-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4>Upload {selectedDataset.label} CSV</h4>
            <button className="btn btn-sm btn-secondary" onClick={resetWizard}>
              ← Change Dataset
            </button>
          </div>

          <div className="template-banner">
            <div>
              <strong>Need a matching format?</strong> Download the official schema template:
            </div>
            <a
              href={`${apiUrl}${selectedDataset.templateUrl}`}
              download={selectedDataset.templateName}
              className="btn btn-sm btn-secondary"
            >
              📥 Download {selectedDataset.label} Template
            </a>
          </div>

          <div className="upload-dropzone">
            <input
              type="file"
              accept=".csv"
              id="csv-file-input"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <label htmlFor="csv-file-input" className="dropzone-label">
              <span style={{ fontSize: 32 }}>📁</span>
              <span style={{ fontWeight: 600 }}>Click to select or drag a CSV file</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Accepts UTF-8 or Latin-1 encoded .csv files up to 25MB
              </span>
            </label>
          </div>

          {uploading && (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
              ⏳ Validating coordinates and schema structure...
            </div>
          )}
        </div>
      )}

      {/* STEP 3: Preview & Validation Table */}
      {currentStep === 3 && previewData && (
        <div className="wizard-step-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <h4 style={{ margin: 0 }}>Data Inspection & Validation</h4>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                File: <strong>{previewData.filename}</strong> ({previewData.total_rows} rows found)
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {previewData.cell_errors.length > 0 && (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={handleDownloadErrorReport}
                >
                  📥 Download Error Report ({previewData.cell_errors.length} issues)
                </button>
              )}
              <button className="btn btn-sm btn-primary" onClick={handleConfirmImport}>
                ✓ Confirm & Import into Grid
              </button>
            </div>
          </div>

          {/* Validation Metrics */}
          <div className="dash-stats-grid" style={{ marginBottom: 12 }}>
            <div className="dash-stat">
              <div className="dash-stat-value">{previewData.total_rows}</div>
              <div className="dash-stat-label">Total Rows</div>
            </div>
            <div className="dash-stat">
              <div className="dash-stat-value" style={{ color: previewData.cell_errors.length === 0 ? '#10b981' : '#f59e0b' }}>
                {previewData.cell_errors.length}
              </div>
              <div className="dash-stat-label">Cell Warnings</div>
            </div>
            <div className="dash-stat">
              <div className="dash-stat-value">{previewData.columns.length}</div>
              <div className="dash-stat-label">Columns Detected</div>
            </div>
          </div>

          {/* Preview Table with Error Highlighting */}
          <div className="preview-table-container">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  {previewData.columns.map((col) => {
                    const isReq = previewData.required_columns.includes(col)
                    return (
                      <th key={col}>
                        {col}
                        {isReq && <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span>}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {previewData.preview_rows.map((row, rIdx) => {
                  const rowNum = rIdx + 1
                  return (
                    <tr key={rIdx}>
                      <td style={{ color: 'var(--text-muted)', fontSize: 10 }}>{rowNum}</td>
                      {previewData.columns.map((col) => {
                        const cellErr = previewData.cell_errors.find(
                          (e) => e.row === rowNum && e.column === col
                        )
                        const val = row[col]
                        return (
                          <td
                            key={col}
                            className={cellErr ? 'cell-invalid' : ''}
                            title={cellErr ? cellErr.reason : undefined}
                          >
                            {val || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span>}
                            {cellErr && <span className="cell-error-tag">!</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
            * Red highlighted cells indicate invalid values or missing required fields. Hover over the badge for the issue.
          </div>
        </div>
      )}

      {/* STEP 4: Build Progress & Confirmation */}
      {currentStep === 4 && (
        <div className="wizard-step-content" style={{ textAlign: 'center', padding: '30px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🚀</div>
          <h3>{buildProgress}</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 450, margin: '0 auto 20px' }}>
            The power distribution network topology and localization engine have been synchronized with your imported dataset.
          </p>
          <button className="btn btn-primary" onClick={resetWizard}>
            Upload Another Dataset
          </button>
        </div>
      )}
    </div>
  )
}

export default CsvImportWizard
