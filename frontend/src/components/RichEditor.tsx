import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { Button, Tooltip, Upload, message } from 'antd';
import {
  BoldOutlined, ItalicOutlined, UnderlineOutlined,
  OrderedListOutlined, UnorderedListOutlined,
  CameraOutlined,
} from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import api from '../api/client';

interface RichEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  requestId?: number;
  maxImages?: number;
}

export default function RichEditor({
  value, onChange, placeholder = 'Введите текст...', minHeight = 120, requestId, maxImages = 5,
}: RichEditorProps) {
  const lastValue = useRef(value);
  const [imageCount, setImageCount] = useState(0);
  // Selecting several screenshots at once (see `multiple` below) calls uploadImage for each one
  // back-to-back, before React has re-rendered `imageCount` in response to the first — a plain
  // state read would let every file in the same batch see the same stale count and all pass the
  // cap check. This ref is bumped synchronously the moment a file is accepted, so the next call
  // in the same batch already sees it; the effect below keeps it in sync with the real count too.
  const acceptedCountRef = useRef(0);

  const countImages = (html: string) => (html.match(/<img[\s>]/g) || []).length;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Image.configure({ allowBase64: true, inline: false }),
      Placeholder.configure({ placeholder }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastValue.current = html;
      setImageCount(countImages(html));
      onChange?.(html === '<p></p>' ? '' : html);
    },
  });

  useEffect(() => { setImageCount(countImages(value || '')); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { acceptedCountRef.current = imageCount; }, [imageCount]);

  useEffect(() => {
    if (editor && value !== lastValue.current) {
      editor.commands.setContent(value || '');
      lastValue.current = value;
    }
  }, [value, editor]);

  // After `setImage`, ProseMirror leaves a NodeSelection on the freshly-inserted image —
  // the next `setImage` call then replaces that selection instead of adding a new image.
  // Inserting a trailing empty paragraph moves the cursor into text mode so each screenshot
  // actually gets added rather than overwriting the last one.
  const insertImage = (src: string) => {
    editor?.chain().focus().insertContent([{ type: 'image', attrs: { src } }, { type: 'paragraph' }]).run();
  };

  const uploadImage = async (file: File) => {
    if (acceptedCountRef.current >= maxImages) {
      message.warning(`Можно добавить не более ${maxImages} скриншотов`);
      return false;
    }
    acceptedCountRef.current += 1; // reserve the slot now, before any await, for the batch above
    if (requestId) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('artifactType', 'other');
      const res = await api.post(`/requests/${requestId}/artifacts`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const filename = res.data.storedFilename;
      insertImage(`/api/files/${filename}`);
    } else {
      // Embed as base64 when no requestId (e.g., new request form)
      const reader = new FileReader();
      reader.onload = e => insertImage(e.target?.result as string);
      reader.readAsDataURL(file);
    }
    return false;
  };

  if (!editor) return null;

  const ToolBtn = ({ title, active, onClick, icon }: { title: string; active?: boolean; onClick: () => void; icon: React.ReactNode }) => (
    <Tooltip title={title}>
      <Button
        size="small"
        type={active ? 'primary' : 'text'}
        icon={icon}
        onClick={onClick}
        style={{ minWidth: 28, padding: '0 6px' }}
      />
    </Tooltip>
  );

  return (
    <div style={{
      border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden',
      background: '#fff', transition: 'border-color 0.2s',
    }}
      onFocus={e => (e.currentTarget.style.borderColor = '#1677ff')}
      onBlur={e => (e.currentTarget.style.borderColor = '#d9d9d9')}
    >
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px',
        borderBottom: '1px solid #f0f0f0', background: '#fafafa', flexWrap: 'wrap',
      }}>
        <ToolBtn title="Жирный (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} icon={<BoldOutlined />} />
        <ToolBtn title="Курсив (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} icon={<ItalicOutlined />} />
        <ToolBtn title="Подчёркнутый" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} icon={<UnderlineOutlined />} />
        <div style={{ width: 1, height: 18, background: '#e0e0e0', margin: '0 4px' }} />
        <ToolBtn title="Маркированный список" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} icon={<UnorderedListOutlined />} />
        <ToolBtn title="Нумерованный список" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={<OrderedListOutlined />} />
      </div>

      {/* Editor content — capped height so a few full-size screenshots while composing don't
          push the attach button (and the rest of the form) out of view; scrolls internally. */}
      <EditorContent
        editor={editor}
        style={{ minHeight, maxHeight: Math.max(minHeight, 320), overflowY: 'auto', padding: '8px 12px', cursor: 'text' }}
        onClick={() => editor.commands.focus()}
      />

      {/* Screenshot attach — a separate, clearly-labeled control rather than a small toolbar
          icon, since it's easy to miss buried among the formatting buttons. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        borderTop: '1px solid #f0f0f0', background: '#fafafa',
      }}>
        <Upload showUploadList={false} accept="image/*" beforeUpload={uploadImage} multiple>
          <Button size="small" icon={<CameraOutlined />} disabled={imageCount >= maxImages}>
            Добавить скриншот
          </Button>
        </Upload>
        <span style={{ fontSize: 12, color: '#aaa' }}>{imageCount} / {maxImages}</span>
      </div>
    </div>
  );
}
