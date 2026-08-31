import { useEffect, useRef, useState } from "react";
import { Bot, Send, X, Sparkles, RotateCcw } from "lucide-react";
type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
};
const suggestions = [
    "Summarize the last 24 hours",
    "Which routes are slowest?",
    "What changed after the latest release?",
    "Find suspicious network failures",
];
interface AIChatWidgetProps {
    appId?: string;
    onAnalyze?: (question: string, model: string) => Promise<{
        summary: string;
        confidence: number;
        findings: { title: string; evidence: string; severity: string }[];}>;
    model?: string;
}
export function AIChatWidget({ appId, model = "llama3.2:3b", onAnalyze }: AIChatWidgetProps) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) setTimeout(() => inputRef.current?.focus(), 200);
    }, [open]);
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);
    const requestIdRef = useRef(0);

    function formatAnalysisResponse(result: { summary: string; confidence: number; findings: { title: string; evidence: string }[] }) {
        const findingsText = result.findings
            .map((finding) => `• ${finding.title}: ${finding.evidence}`)
            .join("\n\n");

        return [result.summary, findingsText, `Confidence: ${Math.round(result.confidence * 100)}%`].filter(Boolean).join("\n\n");
    }

    async function handleSend(text?: string) {
        const question = (text || input).trim();
        if (!question || loading) return;

        const requestId = ++requestIdRef.current;
        const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: question, timestamp: new Date() };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setLoading(true);

        try {
            if (onAnalyze) {
                const result = await onAnalyze(question, model);
                if (requestId !== requestIdRef.current) return;

                const formattedContent = formatAnalysisResponse(result);
                setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: formattedContent, timestamp: new Date() }]);
            } else {
                await new Promise((r) => setTimeout(r, 1200));
                if (requestId !== requestIdRef.current) return;

                setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: `Analysis of "${question}": No data provider connected. Pass onAnalyze handler to get real results.`, timestamp: new Date() }]);
            }
        } catch (error) {
            if (requestId !== requestIdRef.current) return;
            const errorMessage = error instanceof Error ? error.message : "Failed to analyze. Check that your model is running.";
            setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: errorMessage, timestamp: new Date() }]);
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    }
    return (
        <>

            {open && (
                <div className="fixed inset-0 z-[998] bg-black/30 animate-in fade-in duration-200"
                    onClick={() => setOpen(false)}>
                </div>
            )}

            <div className={`fixed bottom-[90px] right-6 z-[999] w-[380px] max-w-[calc(100vw-32px)] h-[560px] max-h-[calc(100vh-120px)] flex flex-col rounded-2xl border border-line bg-panel shadow-2xl shadow-black/50 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]
          ${open ? "translate-y-0 scale-100 opacity-100 pointer-events-auto" : "translate-y-5 scale-95 opacity-0 pointer-events-none"}`}>

                <div className="flex items-center gap-3 px-4 py-3.5 bg-gradient-to-r bg-accent flex-shrink-0">
                    <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white">
                        <Sparkles size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-white">AI Assistant</div>
                        <div className="text-[11px] text-white/70">{appId ? `App: ${appId.slice(0, 12)}` : "Ready to help"}</div>
                    </div>
                    <button onClick={() => { requestIdRef.current += 1; setMessages([]); }} className="w-7 h-7 rounded-md bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
                        <RotateCcw size={14} />
                    </button>
                    <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-md bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 scrollbar-thin">
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-center px-4">
                            <Bot size={32} className="text-white/15 mb-3" />
                            <p className="text-white font-semibold text-base">Ask anything</p>
                            <p className="text-white/40 text-[13px] mb-5">Analyze charts, logs, metrics without leaving this page</p>
                            <div className="flex flex-col gap-2 w-full max-w-[280px]">
                                {suggestions.map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => handleSend(s)}
                                        className="px-3.5 py-2.5 rounded-[10px] border border-line bg-ink/50 text-white/70 text-[13px] text-left hover:bg-ink hover:border-white/15 hover:text-white transition-all"
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex gap-2 max-w-[90%] animate-in slide-in-from-bottom-2 fade-in duration-200 ${msg.role === "user" ? "self-end flex-row-reverse" : ""}`}>
                            {msg.role === "assistant" && (
                                <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                                    <Bot size={14} />
                                </div>
                            )}
                            <div className={`px-3.5 py-2.5 rounded-xl text-[13px] leading-relaxed text-slate-300 break-words 
                            ${msg.role === "user"
                                ? "bg-accent text-white rounded-br-sm"
                                : "bg-ink rounded-bl-sm"
                            }
              `}>
                                <p>{msg.content}</p>
                                <span className={`block text-[10px] mt-1 ${msg.role === "user" ? "text-white/50" : "text-white/30"}`}>
                  {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                            </div>
                        </div>
                    ))}
                    {loading && (
                        <div className="flex gap-2 max-w-[90%]">
                            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                                <Bot size={14} />
                            </div>
                            <div className="px-4 py-3 rounded-xl bg-ink rounded-bl-sm flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:0ms]" />
                                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:150ms]" />
                                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce [animation-delay:300ms]" />
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                <div className="flex gap-2 p-3 border-t border-line bg-ink/50 flex-shrink-0">
                    <input ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
                        placeholder="Ask about your data..."
                        disabled={loading}
                        className="flex-1 h-10 px-3.5 rounded-[10px] border border-line bg-ink text-white text-[13px] outline-none focus:border-cyan-500/60 placeholder:text-white/30 disabled:opacity-50 transition-colors"
                    />
                    <button onClick={() => handleSend()}
                        disabled={!input.trim() || loading}
                        className="w-10 h-10 rounded-[10px] bg-accent text-white flex items-center justify-center hover:scale-105 hover:shadow-lg hover:shadow-cyan-300/40 transition-all flex-shrink-0">
                        <Send size={16} />
                    </button>
                </div>
            </div>

            {!open && (
                <button onClick={() => setOpen(true)}
                    className="fixed bottom-6 right-6 z-[997] w-14 h-14 rounded-full bg-accent text-white flex items-center justify-center shadow-lg shadow-accent/50 hover:scale-110 hover:shadow-xl hover:shadow-cyan-600/60 transition-all duration-300 animate-[pulse_2s_infinite]"
                    style={{ animation: "widgetPulse 2s infinite" }}>
                    <Sparkles size={22} />
                </button>
            )}
        </>
    );
}
