import { useState, useRef } from 'react'
import { Paperclip, X, File, FileImage, FileText, FileSpreadsheet, FileArchive, Music, Video, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'

export interface AttachmentFile {
  id: string
  file: File
  uploading: boolean
  error?: string
  uploaded?: boolean
  serverData?: {
    filename: string
    originalName: string
    mimeType: string
    size: number
    path: string
  }
}

interface AttachmentUploadProps {
  attachments: AttachmentFile[]
  onChange: (attachments: AttachmentFile[]) => void
  maxFiles?: number
  maxSize?: number
}

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return FileImage
  if (mimeType.startsWith('text/')) return FileText
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return FileSpreadsheet
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return FileArchive
  if (mimeType.startsWith('audio/')) return Music
  if (mimeType.startsWith('video/')) return Video
  return File
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function AttachmentUpload({ 
  attachments, 
  onChange, 
  maxFiles = 10, 
  maxSize = 10 
}: AttachmentUploadProps) {
  const { t } = useI18n()
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv',
    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    'audio/mpeg', 'audio/wav',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]

  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return
    
    const newAttachments: AttachmentFile[] = []
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      
      if (attachments.length + newAttachments.length >= maxFiles) {
        break
      }
      
      if (!allowedTypes.includes(file.type)) {
        newAttachments.push({
          id: `${Date.now()}-${i}`,
          file,
          uploading: false,
          error: t('fileTypeNotAllowed')
        })
        continue
      }
      
      if (file.size > maxSize * 1024 * 1024) {
        newAttachments.push({
          id: `${Date.now()}-${i}`,
          file,
          uploading: false,
          error: t('fileTooLarge')
        })
        continue
      }
      
      newAttachments.push({
        id: `${Date.now()}-${i}`,
        file,
        uploading: false
      })
    }
    
    onChange([...attachments, ...newAttachments])
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFileSelect(e.dataTransfer.files)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  const removeAttachment = (id: string) => {
    onChange(attachments.filter(a => a.id !== id))
  }

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="space-y-3">
      <div
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors"
        style={{ 
          borderColor: dragOver ? 'var(--color-accent-primary)' : 'var(--color-border-primary)',
          backgroundColor: dragOver ? 'var(--color-accent-muted)' : 'var(--color-bg-tertiary)'
        }}
      >
        <Paperclip className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--color-text-tertiary)' }} />
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t('dropFilesHere')}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-quaternary)' }}>
          {t('maxFileSize')}: {maxSize}MB, {t('maxFiles')}: {maxFiles}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={allowedTypes.join(',')}
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />
      </div>

      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map(attachment => {
            const Icon = getFileIcon(attachment.file.type)
            
            return (
              <div
                key={attachment.id}
                className="flex items-center gap-3 p-2 rounded-lg border"
                style={{ 
                  backgroundColor: 'var(--color-bg-tertiary)',
                  borderColor: 'var(--color-border-primary)'
                }}
              >
                <div 
                  className="w-8 h-8 rounded flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'var(--color-bg-secondary)' }}
                >
                  <Icon className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {attachment.file.name}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    {formatFileSize(attachment.file.size)}
                  </p>
                </div>
                
                {attachment.uploading && (
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--color-accent-primary)' }} />
                )}
                
                {attachment.error && (
                  <span className="text-xs" style={{ color: '#ef4444' }}>{attachment.error}</span>
                )}
                
                {attachment.uploaded && (
                  <span className="text-xs" style={{ color: '#22c55e' }}>{t('uploaded')}</span>
                )}
                
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="p-1 rounded transition-colors"
                  style={{ color: 'var(--color-text-quaternary)' }}
                >
                  <X className="w-4 h-4 hover:text-red-500" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
