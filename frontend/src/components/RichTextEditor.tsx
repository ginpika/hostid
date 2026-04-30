/**
 * 富文本编辑器组件
 * 基于 TipTap 实现，支持粗体、斜体、列表、引用等格式
 * 提供三种模式：富文本、HTML源代码、Markdown源代码
 */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered,
  Quote, Undo, Redo, Highlighter, Code, FileCode, Link, Image, Type,
  Heading1, Heading2, Heading3, Minus, Plus, Maximize2, Minimize2
} from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'

type EditorMode = 'rich' | 'html' | 'markdown'

interface RichTextEditorProps {
  content: string
  onChange: (html: string) => void
  placeholder?: string
}

export default function RichTextEditor({ content, onChange, placeholder }: RichTextEditorProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<EditorMode>('rich')
  const [sourceCode, setSourceCode] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [lineHeight, setLineHeight] = useState<1.0 | 1.15 | 1.5 | 2.0>(1.0)
  const [showLineHeightMenu, setShowLineHeightMenu] = useState(false)
  const [, forceUpdate] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const lineHeightOptions: { value: 1.0 | 1.15 | 1.5 | 2.0; label: string }[] = [
    { value: 1.0, label: t('lineHeightSingle') },
    { value: 1.15, label: t('lineHeight1_15') },
    { value: 1.5, label: t('lineHeight1_5') },
    { value: 2.0, label: t('lineHeightDouble') },
  ]

  const handleLineHeightChange = (value: 1.0 | 1.15 | 1.5 | 2.0) => {
    setLineHeight(value)
    setShowLineHeightMenu(false)
  }

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
      }
    }

    if (isFullscreen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isFullscreen])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
      }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: false,
      }),
    ],
    content: content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    onSelectionUpdate: () => {
      forceUpdate(prev => prev + 1)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none p-3',
        style: `background-color: var(--color-bg-primary); color: var(--color-text-primary); font-size: 15px; line-height: ${lineHeight}; margin: 0;`,
      },
    },
  })

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false })
    }
  }, [content, editor])

  const switchMode = (newMode: EditorMode) => {
    if (newMode === mode) return

    if (mode === 'rich') {
      const isEmpty = editor?.isEmpty || !editor?.getText().trim()
      setSourceCode(isEmpty ? '' : (editor?.getHTML() || ''))
    } else if (newMode === 'rich') {
      const contentToSet = sourceCode.trim() === '' ? '' : sourceCode
      editor?.commands.setContent(contentToSet, { emitUpdate: false })
      onChange(contentToSet)
    }

    setMode(newMode)
  }

  const handleSourceChange = (value: string) => {
    setSourceCode(value)
    onChange(value)
  }

  const insertText = (text: string, moveCursorBack: number = 0) => {
    if (!textareaRef.current) return

    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = textarea.value.substring(0, start)
    const after = textarea.value.substring(end)
    
    const newValue = before + text + after
    setSourceCode(newValue)
    onChange(newValue)

    setTimeout(() => {
      textarea.focus()
      const newCursorPos = start + text.length - moveCursorBack
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
  }

  const insertAroundSelection = (beforeText: string, afterText: string) => {
    if (!textareaRef.current) return

    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = textarea.value.substring(start, end)
    const before = textarea.value.substring(0, start)
    const after = textarea.value.substring(end)
    
    const newValue = before + beforeText + selectedText + afterText + after
    setSourceCode(newValue)
    onChange(newValue)

    setTimeout(() => {
      textarea.focus()
      if (selectedText.length > 0) {
        textarea.setSelectionRange(start + beforeText.length, start + beforeText.length + selectedText.length)
      } else {
        textarea.setSelectionRange(start + beforeText.length, start + beforeText.length)
      }
    }, 0)
  }

  const getFormatState = (formatName: string): 'active' | 'partial' | 'inactive' => {
    if (!editor) return 'inactive'
    
    const { from, to } = editor.state.selection
    if (from === to) {
      return editor.isActive(formatName) ? 'active' : 'inactive'
    }
    
    let hasFormat = false
    let hasNoFormat = false
    
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText) {
        const hasMark = node.marks.some(mark => mark.type.name === formatName)
        if (hasMark) hasFormat = true
        else hasNoFormat = true
      }
    })
    
    if (hasFormat && hasNoFormat) return 'partial'
    if (hasFormat) return 'active'
    return 'inactive'
  }

  const handleEditorClick = (e: React.MouseEvent) => {
    if (mode !== 'rich' || !editor) return
    
    const target = e.target as HTMLElement
    const editorContainer = target.closest('.ProseMirror')
    
    if (!editorContainer) {
      editor.commands.focus('end')
    }
  }

  const handleTextareaClick = () => {
    if (!textareaRef.current) return
    
    const textarea = textareaRef.current
    if (textarea.value.trim() === '') {
      textarea.focus()
      textarea.setSelectionRange(0, 0)
    }
  }

  const ToolbarButton = ({ 
    onClick, 
    isActive = false,
    isPartial = false,
    disabled = false, 
    children,
    title 
  }: { 
    onClick: () => void
    isActive?: boolean
    isPartial?: boolean
    disabled?: boolean
    children: React.ReactNode
    title: string
  }) => {
    const getButtonStyle = () => {
      const baseStyle = {
        border: '1px solid transparent'
      }
      
      if (isPartial) {
        return {
          ...baseStyle,
          color: 'var(--color-accent-primary)',
          backgroundColor: 'rgba(14, 165, 233, 0.15)',
          borderColor: 'rgba(14, 165, 233, 0.3)'
        }
      }
      if (isActive) {
        return {
          ...baseStyle,
          color: 'var(--color-accent-primary)',
          backgroundColor: 'var(--color-accent-muted)',
          borderColor: 'var(--color-accent-primary)'
        }
      }
      return {
        ...baseStyle,
        color: 'var(--color-text-secondary)',
        backgroundColor: 'transparent'
      }
    }

    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className="p-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center"
        style={{ ...getButtonStyle(), height: '28px' }}
      >
        {children}
      </button>
    )
  }

  const Divider = () => (
    <div 
      className="w-px h-5 mx-1" 
      style={{ backgroundColor: 'var(--color-border-primary)' }} 
    />
  )

  if (!editor) {
    return null
  }

  const getModeLabel = () => {
    switch (mode) {
      case 'rich':
        return t('richTextMode')
      case 'html':
        return t('htmlMode')
      case 'markdown':
        return t('markdownMode')
      default:
        return ''
    }
  }

  const editorContent = (
    <>
      {!isFullscreen && (
        <div
          className="absolute right-2 z-10 px-2 py-0.5 rounded text-xs font-medium"
          style={{
            top: '-1.625rem',
            backgroundColor: mode === 'rich' ? 'var(--color-accent-muted)' : 'var(--color-bg-tertiary)',
            color: mode === 'rich' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
            border: '1px solid',
            borderColor: mode === 'rich' ? 'var(--color-accent-primary)' : 'var(--color-border-primary)'
          }}
        >
          {getModeLabel()}
        </div>
      )}
      <div 
        className={`rich-text-editor border rounded-lg overflow-hidden focus-within:ring-2 relative ${isFullscreen ? 'rounded-none flex-1 flex flex-col' : ''}`}
        style={{ 
          borderColor: 'var(--color-border-primary)',
          backgroundColor: 'var(--color-bg-primary)',
          ...(isFullscreen ? { height: '100%', width: '100%' } : {})
        }}
      >
        {isFullscreen && (
          <div
            className="absolute right-2 z-10 px-2 py-0.5 rounded text-xs font-medium"
            style={{
              top: '3.5rem',
              backgroundColor: mode === 'rich' ? 'var(--color-accent-muted)' : 'var(--color-bg-tertiary)',
              color: mode === 'rich' ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
              border: '1px solid',
              borderColor: mode === 'rich' ? 'var(--color-accent-primary)' : 'var(--color-border-primary)'
            }}
          >
            {getModeLabel()}
          </div>
        )}
        <div 
          className={`border-b flex flex-wrap items-center gap-0.5 ${isFullscreen ? 'flex-shrink-0' : ''}`}
          style={{ 
            borderColor: 'var(--color-border-primary)',
            backgroundColor: 'var(--color-bg-tertiary)',
            padding: '6px 6px',
            minHeight: '40px'
          }}
        >
          {mode === 'rich' && (
            <>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBold().run()}
                isActive={getFormatState('bold') === 'active'}
                isPartial={getFormatState('bold') === 'partial'}
                title={t('bold')}
              >
                <Bold className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleItalic().run()}
                isActive={getFormatState('italic') === 'active'}
                isPartial={getFormatState('italic') === 'partial'}
                title={t('italic')}
              >
                <Italic className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                isActive={getFormatState('underline') === 'active'}
                isPartial={getFormatState('underline') === 'partial'}
                title={t('underline')}
              >
                <UnderlineIcon className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                isActive={getFormatState('strike') === 'active'}
                isPartial={getFormatState('strike') === 'partial'}
                title={t('strikethrough')}
              >
                <Strikethrough className="w-4 h-4" />
              </ToolbarButton>
              
              <Divider />
              
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHighlight().run()}
                isActive={getFormatState('highlight') === 'active'}
                isPartial={getFormatState('highlight') === 'partial'}
                title={t('highlight')}
              >
                <Highlighter className="w-4 h-4" />
              </ToolbarButton>
              
              <Divider />
              
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                isActive={editor.isActive('bulletList')}
                title={t('bulletList')}
              >
                <List className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                isActive={editor.isActive('orderedList')}
                title={t('orderedList')}
              >
                <ListOrdered className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                isActive={editor.isActive('blockquote')}
                title={t('blockquote')}
              >
                <Quote className="w-4 h-4" />
              </ToolbarButton>
              
              <Divider />
              
              <div className="relative">
                <button
                  onClick={() => setShowLineHeightMenu(!showLineHeightMenu)}
                  className="px-3 py-1.5 rounded text-sm font-medium transition-colors inline-flex items-center"
                  style={{
                    color: lineHeight !== 1.0 ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
                    backgroundColor: lineHeight !== 1.0 ? 'var(--color-accent-muted)' : 'transparent',
                    border: '1px solid transparent',
                    height: '28px',
                    lineHeight: '1'
                  }}
                  title={t('lineHeight')}
                >
                  {t('lineHeight')}
                </button>
                
                {showLineHeightMenu && (
                  <div 
                    className="absolute top-full left-0 mt-1 border rounded-lg shadow-lg overflow-hidden z-10 min-w-[120px]"
                    style={{
                      backgroundColor: 'var(--color-bg-secondary)',
                      borderColor: 'var(--color-border-primary)'
                    }}
                  >
                    {lineHeightOptions.map(option => (
                      <button
                        key={option.value}
                        onClick={() => handleLineHeightChange(option.value)}
                        className="block w-full px-3 py-2 text-sm whitespace-nowrap transition-colors"
                        style={{
                          backgroundColor: lineHeight === option.value ? 'var(--color-accent-muted)' : 'transparent',
                          color: lineHeight === option.value ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)'
                        }}
                        onMouseEnter={(e) => {
                          if (lineHeight !== option.value) {
                            e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (lineHeight !== option.value) {
                            e.currentTarget.style.backgroundColor = 'transparent'
                          }
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              <Divider />
              
              <ToolbarButton
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                title={t('undo')}
              >
                <Undo className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                title={t('redo')}
              >
                <Redo className="w-4 h-4" />
              </ToolbarButton>
            </>
          )}

          {mode === 'html' && (
            <>
              <ToolbarButton
                onClick={() => insertAroundSelection('<strong>', '</strong>')}
                title={t('insertBold')}
              >
                <Bold className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertAroundSelection('<em>', '</em>')}
                title={t('insertItalic')}
              >
                <Italic className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertAroundSelection('<u>', '</u>')}
                title={t('insertUnderline')}
              >
                <UnderlineIcon className="w-4 h-4" />
              </ToolbarButton>
              
              <Divider />
              
              <ToolbarButton
                onClick={() => insertAroundSelection('<a href="">', '</a>')}
                title={t('insertLink')}
              >
                <Link className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertText('<img src="" alt="" />', 4)}
                title={t('insertImage')}
              >
                <Image className="w-4 h-4" />
              </ToolbarButton>
              
              <Divider />
              
              <ToolbarButton
                onClick={() => insertAroundSelection('<div>', '</div>')}
                title={t('insertDiv')}
              >
                <Type className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertAroundSelection('<span>', '</span>')}
                title={t('insertSpan')}
              >
                <Plus className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertText('<br />')}
                title={t('insertBreak')}
              >
                <Minus className="w-4 h-4" />
              </ToolbarButton>
            </>
          )}

          {mode === 'markdown' && (
            <>
              <ToolbarButton
                onClick={() => insertAroundSelection('**', '**')}
                title={t('insertBold')}
              >
                <Bold className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertAroundSelection('*', '*')}
                title={t('insertItalic')}
              >
                <Italic className="w-4 h-4" />
              </ToolbarButton>
              
              <Divider />
              
              <ToolbarButton
                onClick={() => insertText('# ', 0)}
                title={t('insertH1')}
              >
                <Heading1 className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertText('## ', 0)}
                title={t('insertH2')}
              >
                <Heading2 className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertText('### ', 0)}
                title={t('insertH3')}
              >
                <Heading3 className="w-4 h-4" />
              </ToolbarButton>
              
              <Divider />
              
              <ToolbarButton
                onClick={() => insertText('- ', 0)}
                title={t('insertBulletList')}
              >
                <List className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertText('1. ', 0)}
                title={t('insertOrderedList')}
              >
                <ListOrdered className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertText('> ', 0)}
                title={t('insertBlockquote')}
              >
                <Quote className="w-4 h-4" />
              </ToolbarButton>
              
              <Divider />
              
              <ToolbarButton
                onClick={() => insertAroundSelection('[', '](url)')}
                title={t('insertLink')}
              >
                <Link className="w-4 h-4" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => insertText('![alt](url)', 0)}
                title={t('insertImage')}
              >
                <Image className="w-4 h-4" />
              </ToolbarButton>
            </>
          )}
          
          <div className="flex-1" />
          
          <ToolbarButton
            onClick={() => switchMode('rich')}
            isActive={mode === 'rich'}
            title={t('richTextMode')}
          >
            <Type className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => switchMode('html')}
            isActive={mode === 'html'}
            title={t('htmlMode')}
          >
            <Code className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => switchMode('markdown')}
            isActive={mode === 'markdown'}
            title={t('markdownMode')}
          >
            <FileCode className="w-4 h-4" />
          </ToolbarButton>
          
          <Divider />
          
          <ToolbarButton
            onClick={() => setIsFullscreen(!isFullscreen)}
            isActive={isFullscreen}
            title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </ToolbarButton>
        </div>
        
        <div 
          className={`relative cursor-text overflow-y-auto ${isFullscreen ? 'flex-1' : 'h-[232px]'}`}
          style={{ backgroundColor: 'var(--color-bg-primary)' }}
          onClick={handleEditorClick}
        >
          {mode === 'rich' ? (
            <>
              <EditorContent 
                editor={editor} 
                placeholder={placeholder}
              />
              {!editor.getText() && (
                <div 
                  className="absolute top-4 left-4 pointer-events-none"
                  style={{ color: 'var(--color-text-quaternary)' }}
                >
                  {placeholder}
                </div>
              )}
            </>
          ) : (
            <textarea
              ref={textareaRef}
              value={sourceCode}
              onChange={(e) => handleSourceChange(e.target.value)}
              onClick={handleTextareaClick}
              className="w-full h-full p-3 text-sm font-mono resize-none focus:outline-none absolute inset-0 cursor-text"
              style={{ 
                backgroundColor: 'var(--color-bg-primary)',
                color: 'var(--color-text-primary)',
                borderColor: 'transparent',
                lineHeight: lineHeight
              }}
              placeholder={mode === 'html' ? '<html>...' : '# Markdown...'}
            />
          )}
        </div>
      </div>
    </>
  )

  if (isFullscreen) {
    return createPortal(
      <div 
        className="fixed inset-0 z-[9999] flex flex-col"
        style={{ 
          height: '100vh', 
          width: '100vw', 
          top: '0', 
          left: '0',
          backgroundColor: 'var(--color-bg-secondary)'
        }}
      >
        {editorContent}
      </div>,
      document.body
    )
  }

  return (
    <div className="relative">
      {editorContent}
    </div>
  )
}