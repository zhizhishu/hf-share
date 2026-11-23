import { forwardRef, useImperativeHandle } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

/**
 * 富文本编辑器（TipTap / ProseMirror）。
 *
 * 为什么用它：ProseMirror 的 schema 是白名单模型 —— 不在 schema 里的节点物理上进不来，
 * div soup 与杂散内联 style 从根上不会出现；粘贴 Word/Outlook 富文本也会被自动过滤，
 * 这正是邮件正文最容易翻车的地方。
 *
 * 体积代价：@tiptap/* 约 100KB gzip，所以本组件只应动态 import（见 ComposeCard），
 * 不要进首屏主包。
 */

export type RichFmt = { bold: boolean; italic: boolean; underline: boolean; ul: boolean; ol: boolean; block: string };

export type RichEditorHandle = {
  /** 兼容旧用法：读当前 HTML */
  readonly innerHTML: string;
  /** 兼容旧用法：整体替换内容 */
  innerHTML2?: never;
  setHTML(html: string): void;
  focus(): void;
  /** 工具栏命令（沿用旧的 execCommand 名字，内部映射到 TipTap 命令） */
  run(cmd: string, val?: string): void;
  state(): RichFmt;
};

type Props = { initialHTML?: string; onChange?: (html: string) => void; placeholder?: string };

const EMPTY_FMT: RichFmt = { bold: false, italic: false, underline: false, ul: false, ol: false, block: "" };

function mapFmt(editor: Editor | null): RichFmt {
  if (!editor) return EMPTY_FMT;
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    ul: editor.isActive("bulletList"),
    ol: editor.isActive("orderedList"),
    block: editor.isActive("heading", { level: 2 }) ? "h2" : "p"
  };
}

function applyCommand(editor: Editor | null, cmd: string, val?: string): void {
  if (!editor) return;
  const c = editor.chain().focus();
  switch (cmd) {
    case "bold": c.toggleBold().run(); break;
    case "italic": c.toggleItalic().run(); break;
    case "underline": c.toggleUnderline().run(); break;
    case "strikeThrough": c.toggleStrike().run(); break;
    case "insertUnorderedList": c.toggleBulletList().run(); break;
    case "insertOrderedList": c.toggleOrderedList().run(); break;
    case "formatBlock": c.setParagraph().run(); break;
    case "createLink": c.extendMarkRange("link").setLink({ href: val || "" }).run(); break;
    case "unlink": c.unsetLink().run(); break;
    case "insertHTML": c.insertContent(val || "").run(); break;
    case "undo": c.undo().run(); break;
    case "redo": c.redo().run(); break;
    default: break;
  }
}

export const RichTextEditor = forwardRef<RichEditorHandle, Props>(function RichTextEditor(
  { initialHTML = "", onChange, placeholder },
  ref
) {
  const editor = useEditor({
    extensions: [
      // 裁到邮件需要的：粗体/斜体/删除线/列表/换行/撤销；关掉代码块、引用块、标题、表格等重件
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false
      })
    ],
    content: initialHTML || "",
    editorProps: {
      attributes: {
        class: "rt-content",
        "data-placeholder": placeholder || ""
      }
    },
    onUpdate: ({ editor: e }) => onChange?.(e.getHTML())
  });

  useImperativeHandle(
    ref,
    () => ({
      get innerHTML() {
        return editor?.getHTML() ?? "";
      },
      setHTML(html: string) {
        editor?.commands.setContent(html || "");
      },
      focus() {
        editor?.commands.focus();
      },
      run(cmd: string, val?: string) {
        applyCommand(editor, cmd, val);
      },
      state() {
        return mapFmt(editor);
      }
    }),
    [editor]
  );

  return <EditorContent editor={editor} className="rt-wrap" />;
});
