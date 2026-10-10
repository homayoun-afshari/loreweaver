import { ChatPanel } from "@/components/chat/chat-panel";

// The route group "(chat)" is only a folder for organisation: it adds nothing to the URL,
// so this page is served at "/".
export default function ChatPage() {
  return <ChatPanel />;
}
