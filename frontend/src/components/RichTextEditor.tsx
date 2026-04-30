/**
 * 富文本编辑器组件
 * 基于 TipTap 实现，支持粗体、斜体、列表、引用等格式
 * 提供源码模式切换和撤销/重做功能
 */
import { useState, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered,
  Quote, Undo, Redo, Highlighter, Code
} from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'

interface RichTextEditorProps {
  content: string
  onChange: (html: string) => void
  placeholder?: string
}

export default function RichTextEditor({ content, onChange, placeholder }: RichTextEditorProps) {
  const { t } = useI18n()
  const [isSourceMode, setIsSourceMode] = useState(false)
  const [sourceCode, setSourceCode] = useState('')

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
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[200px] p-3',
        style: 'background-color: var(--color-bg-primary); color: var(--color-text-primary);',
      },
    },
  })

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false })
    }
  }, [content, editor])

  const toggleMode = () => {
    if (isSourceMode) {
      editor?.commands.setContent(sourceCode, { emitUpdate: false })
      onChange(sourceCode)
    } else {
      setSourceCode(editor?.getHTML() || '')
    }
    setIsSourceMode(!isSourceMode)
  }

  const handleSourceChange = (value: string) => {
    setSourceCode(value)
    onChange(value)
  }

  const ToolbarButton = ({ 
    onClick, 
    isActive = false, 
    disabled = false, 
    children,
    title 
  }: { 
    onClick: () => void
    isActive?: boolean
    disabled?: boolean
    children: React.ReactNode
    title: string
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ 
        color: isActive ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
        backgroundColor: isActive ? 'var(--color-accent-muted)' : 'transparent'
      }}
    >
      {children}
    </button>
  )

  const Divider = () => (
    <div 
      className="w-px h-5 mx-1" 
      style={{ backgroundColor: 'var(--color-border-primary)' }} 
    />
  )

  if (!editor) {
    return null
  }

  return (
    <div 
      className="border rounded-lg overflow-hidden focus-within:ring-2"
      style={{ 
        borderColor: 'var(--color-border-primary)',
        backgroundColor: 'var(--color-bg-primary)'
      }}
    >
      <div 
        className="border-b p-1.5 flex flex-wrap items-center gap-0.5"
        style={{ 
          borderColor: 'var(--color-border-primary)',
          backgroundColor: 'var(--color-bg-tertiary)'
        }}
      >
        {!isSourceMode && (
          <>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive('bold')}
              title={t('bold')}
            >
              <Bold className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive('italic')}
              title={t('italic')}
            >
              <Italic className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              isActive={editor.isActive('underline')}
              title={t('underline')}
            >
              <UnderlineIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={editor.isActive('strike')}
              title={t('strikethrough')}
            >
              <Strikethrough className="w-4 h-4" />
            </ToolbarButton>
            
            <Divider />
            
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleHighlight().run()}
              isActive={editor.isActive('highlight')}
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
        
        <div className="flex-1" />
        
        <ToolbarButton
          onClick={toggleMode}
          isActive={isSourceMode}
          title={isSourceMode ? t('richTextMode') : t('sourceCodeMode')}
        >
          <Code className="w-4 h-4" />
        </ToolbarButton>
      </div>
      
      <div className="relative" style={{ backgroundColor: 'var(--color-bg-primary)', minHeight: '232px' }}>
        {isSourceMode ? (
          <textarea
            value={sourceCode}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="w-full h-full min-h-[232px] p-3 text-sm font-mono resize-none focus:outline-none absolute inset-0"
            style={{ 
              backgroundColor: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              borderColor: 'transparent'
            }}
            placeholder="<html>..."
          />
        ) : (
          <>
            <EditorContent 
              editor={editor} 
              placeholder={placeholder}
            />
            {!editor.getText() && (
              <div 
                className="absolute top-3 left-3 pointer-events-none"
                style={{ color: 'var(--color-text-quaternary)' }}
              >
                {placeholder}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
