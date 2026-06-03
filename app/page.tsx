"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import { SendHorizontal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AskResponse = {
  answer?: string;
  sources?: Source[];
  followups?: string[];
  error?: string;
};

type Source = {
  title: string;
  url: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  followups?: string[];
};

export default function Home() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await askQuestion(question);
  }

  async function askQuestion(nextQuestion: string) {
    const trimmedQuestion = nextQuestion.trim();

    if (!trimmedQuestion || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedQuestion
    };

    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setQuestion("");
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ question: trimmedQuestion })
      });

      const data = (await response.json().catch(() => ({}))) as AskResponse;

      if (!response.ok) {
        throw new Error(data.error || "Docs AI could not answer the question.");
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer || "Docs AI returned an empty answer.",
        sources: Array.isArray(data.sources) ? data.sources : [],
        followups: Array.isArray(data.followups) ? data.followups : []
      };

      setMessages((currentMessages) => [...currentMessages, assistantMessage]);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong while asking Docs AI."
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void askQuestion(question);
    }
  }

  return (
    <main className="page">
      <section className="shell" aria-labelledby="assistant-title">
        <div className="chatWindow">
          <header className="chatHeader">
            <div className="chatBrand">
              <img
                className="brandLogo"
                src="https://www.uipath.com/favicon.ico"
                alt=""
                aria-hidden="true"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
              <h1 className="title" id="assistant-title">
                Docs Assistant
              </h1>
            </div>
          </header>

          <div className="messages" aria-live="polite" aria-busy={isLoading}>
            {messages.length === 0 ? (
              <div className="emptyState">
                <p className="emptyTitle">Hi! How can I help you today?</p>
              </div>
            ) : null}

            {messages.map((message) => (
              <article
                className={`message message-${message.role}`}
                key={message.id}
              >
                <div className="messageBody">
                  {message.role === "assistant" ? (
                    <>
                      <div className="answerText markdownAnswer">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ children, ...props }) => (
                              <a {...props} target="_blank" rel="noreferrer">
                                {children}
                              </a>
                            )
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>

                      {message.sources?.length ? (
                        <div className="sources">
                          <div className="sourcesTitle">Sources</div>
                          <ul className="sourceList">
                            {message.sources.map((source) => (
                              <li key={source.url}>
                                <a
                                  className="sourceLink"
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {source.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {message.followups?.length ? (
                        <div className="followups">
                          <div className="followupsTitle">
                            What would you like to know next?
                          </div>
                          <div className="followupList">
                            {message.followups.map((followup) => (
                              <button
                                className="followupButton"
                                disabled={isLoading}
                                key={followup}
                                onClick={() => void askQuestion(followup)}
                                type="button"
                              >
                                {followup}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p>{message.content}</p>
                  )}
                </div>
              </article>
            ))}

            {isLoading ? (
              <article className="message message-assistant">
                <div className="messageBody typing">
                  <span />
                  <span />
                  <span />
                </div>
              </article>
            ) : null}

            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}

          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <div className="composerRow">
              <textarea
                className="questionInput"
                name="question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleQuestionKeyDown}
                placeholder="Ask a new question"
                aria-label="Question"
                disabled={isLoading}
                rows={1}
                autoComplete="off"
              />
              <button
                className="sendButton"
                type="submit"
                disabled={isLoading || !question.trim()}
                title="Send question"
                aria-label="Send question"
              >
                <SendHorizontal size={24} aria-hidden="true" />
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
