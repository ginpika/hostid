import { useState, useEffect } from 'react'
import { Database, Trash2, ChevronLeft, ChevronRight, RefreshCw, Maximize2, Minimize2 } from 'lucide-react'
import Layout from '../components/Layout'
import { useI18n } from '../i18n/I18nContext'

interface TableInfo {
  name: string
  count: number
}

interface TableData {
  columns: string[]
  data: any[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default function AdminPage() {
  const { t } = useI18n()
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [tableData, setTableData] = useState<TableData | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    fetchTables()
  }, [])

  useEffect(() => {
    if (selectedTable) {
      fetchTableData(selectedTable, 1)
    }
  }, [selectedTable])

  const fetchTables = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/admin/tables', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setTables(data.tables)
      } else if (res.status === 403) {
        setError(t('adminAccessDenied'))
      }
    } catch (err) {
      console.error('Failed to fetch tables:', err)
    }
  }

  const fetchTableData = async (tableName: string, pageNum: number) => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/admin/tables/${tableName}?page=${pageNum}&pageSize=20`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setTableData(data)
        setPage(pageNum)
      }
    } catch (err) {
      console.error('Failed to fetch table data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!selectedTable) return
    if (!confirm(t('confirmDelete'))) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/admin/tables/${selectedTable}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        fetchTableData(selectedTable, page)
      }
    } catch (err) {
      console.error('Failed to delete record:', err)
    }
  }

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '-'
    if (typeof value === 'boolean') return value ? '✓' : '-'
    if (typeof value === 'object') return JSON.stringify(value).slice(0, 50)
    if (typeof value === 'string' && value.length > 50) return value.slice(0, 50) + '...'
    return String(value)
  }

  const formatDate = (value: any): string => {
    if (!value) return '-'
    try {
      return new Date(value).toLocaleString()
    } catch {
      return String(value)
    }
  }

  const TableContent = () => (
    <div 
      className={`rounded-lg border ${isFullscreen ? 'h-full flex flex-col' : ''}`}
      style={{ 
        backgroundColor: 'var(--color-bg-secondary)',
        borderColor: 'var(--color-border-primary)'
      }}
    >
      <div 
        className="p-4 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--color-border-primary)' }}
      >
        <h3 className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{selectedTable}</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-lg"
            style={{ color: 'var(--color-text-quaternary)' }}
            title={isFullscreen ? t('exitFullscreen') : t('fullscreen')}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => selectedTable && fetchTableData(selectedTable, page)}
            className="p-2 rounded-lg"
            style={{ color: 'var(--color-text-quaternary)' }}
            title={t('refresh')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>{t('loading')}</div>
      ) : tableData ? (
        <>
          <div className={`overflow-x-auto ${isFullscreen ? 'flex-1' : ''}`}>
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
                <tr>
                  {tableData.columns.map(col => (
                    <th 
                      key={col} 
                      className="px-4 py-3 text-left font-medium sticky top-0"
                      style={{ 
                        color: 'var(--color-text-tertiary)',
                        backgroundColor: 'var(--color-bg-tertiary)'
                      }}
                    >
                      {col}
                    </th>
                  ))}
                  <th 
                    className="px-4 py-3 text-left font-medium w-20 sticky top-0"
                    style={{ 
                      color: 'var(--color-text-tertiary)',
                      backgroundColor: 'var(--color-bg-tertiary)'
                    }}
                  >{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--color-border-secondary)' }}>
                {tableData.data.map((row, idx) => (
                  <tr key={row.id || idx} className="hover:bg-opacity-50">
                    {tableData.columns.map(col => (
                      <td key={col} className="px-4 py-3" style={{ color: 'var(--color-text-secondary)' }}>
                        {col === 'createdAt' ? formatDate(row[col]) : formatValue(row[col])}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(row.id)}
                        className="p-1.5 rounded"
                        style={{ color: 'var(--color-text-quaternary)' }}
                        title={t('delete')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {tableData.pagination.totalPages > 1 && (
            <div 
              className="p-4 border-t flex items-center justify-between"
              style={{ borderColor: 'var(--color-border-primary)' }}
            >
              <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('showing')} {(tableData.pagination.page - 1) * tableData.pagination.pageSize + 1} - {Math.min(tableData.pagination.page * tableData.pagination.pageSize, tableData.pagination.total)} {t('of')} {tableData.pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => selectedTable && fetchTableData(selectedTable, page - 1)}
                  disabled={page === 1}
                  className="p-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ color: 'var(--color-text-quaternary)' }}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {page} / {tableData.pagination.totalPages}
                </span>
                <button
                  onClick={() => selectedTable && fetchTableData(selectedTable, page + 1)}
                  disabled={page === tableData.pagination.totalPages}
                  className="p-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ color: 'var(--color-text-quaternary)' }}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  )

  if (error) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p style={{ color: '#ef4444' }}>{error}</p>
          </div>
        </div>
      </Layout>
    )
  }

  if (isFullscreen && selectedTable) {
    return (
      <div className="fixed inset-0 z-50 p-4" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <TableContent />
      </div>
    )
  }

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="max-w-7xl mx-auto p-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('adminPanel')}</h2>
            <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{t('adminDescription')}</p>
          </div>

          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-3">
              <div 
                className="rounded-lg border p-4"
                style={{ 
                  backgroundColor: 'var(--color-bg-secondary)',
                  borderColor: 'var(--color-border-primary)'
                }}
              >
                <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-tertiary)' }}>{t('tables')}</h3>
                <div className="space-y-2">
                  {tables.map(table => (
                    <button
                      key={table.name}
                      onClick={() => setSelectedTable(table.name)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors"
                      style={{ 
                        backgroundColor: selectedTable === table.name 
                          ? 'var(--color-accent-muted)' 
                          : 'transparent',
                        color: selectedTable === table.name 
                          ? 'var(--color-accent-primary)' 
                          : 'var(--color-text-secondary)'
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <Database className="w-4 h-4" />
                        <span>{table.name}</span>
                      </span>
                      <span 
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ 
                          backgroundColor: 'var(--color-bg-tertiary)',
                          color: 'var(--color-text-secondary)'
                        }}
                      >{table.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="col-span-9">
              {selectedTable ? (
                <TableContent />
              ) : (
                <div 
                  className="rounded-lg border p-8 text-center"
                  style={{ 
                    backgroundColor: 'var(--color-bg-secondary)',
                    borderColor: 'var(--color-border-primary)',
                    color: 'var(--color-text-tertiary)'
                  }}
                >
                  {t('selectTable')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
