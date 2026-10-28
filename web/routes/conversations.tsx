import { Badge, Box, Button, Flex, Input, Message, Panel, Text } from "@bigcommerce/big-design";
import { useAction, useFindMany } from "@gadgetinc/react";
import { useState } from "react";
import { api } from "../api";

export const ConversationsPage = () => {
  const [selected, setSelected] = useState<any>(null);
  if (selected) return <Conversation session={selected} onBack={() => setSelected(null)} />;
  return <SessionList onSelect={setSelected} />;
};

function fmtDate(d: any) {
  try { return new Date(d).toLocaleString(); } catch (e) { return ""; }
}

function SessionList({ onSelect }: { onSelect: (s: any) => void }) {
  const [q, setQ] = useState("");
  // @ts-ignore
  const [{ data, fetching, error }] = useFindMany(api.chatSession, {
    sort: { updatedAt: "Descending" },
    first: 250,
  });

  const query = q.trim().toLowerCase();
  const [needsHumanOnly, setNeedsHumanOnly] = useState(false);
  const sessions = (data || []).filter(
    (s: any) =>
      (!needsHumanOnly || s.needsHuman) &&
      (!query || (s.preview || "").toLowerCase().includes(query) || (s.sessionId || "").toLowerCase().includes(query))
  );
  const waiting = (data || []).filter((s: any) => s.needsHuman).length;

  return (
    <Panel header="Conversations" description="Chat sessions from your storefront assistant.">
      <Flex marginBottom="small" flexGap="8px" alignItems="center">
        <Box style={{ flex: 1 }}>
          <Input placeholder="Search conversations…" value={q} onChange={(e) => setQ(e.target.value)} />
        </Box>
        <Button variant={needsHumanOnly ? "primary" : "secondary"} onClick={() => setNeedsHumanOnly((v) => !v)}>
          {"Needs human (" + waiting + ")"}
        </Button>
      </Flex>
      {fetching && <Text color="secondary60">Loading…</Text>}
      {error && <Message type="error" messages={[{ text: "Couldn't load conversations." }]} />}
      {data && sessions.length === 0 && !fetching && (
        <Text color="secondary60">{query ? "No conversations match your search." : "No conversations yet. They'll appear here once shoppers start chatting."}</Text>
      )}
      {sessions.map((s: any) => (
        <Box
          key={s.id}
          border="box"
          borderRadius="normal"
          padding="small"
          marginBottom="xSmall"
          style={{ cursor: "pointer" }}
          onClick={() => onSelect(s)}
        >
          <Flex justifyContent="space-between" alignItems="center" flexGap="12px">
            <Box style={{ minWidth: 0 }}>
              <Flex flexGap="8px" alignItems="center">
                {s.needsHuman && <Badge variant="warning" label="Needs human" />}
                <Text bold marginBottom="none" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.preview || "(no preview)"}
                </Text>
              </Flex>
              <Text color="secondary60" marginBottom="none">
                {(s.messageCount ?? 0) + " messages · " + fmtDate(s.updatedAt) + (s.model ? " · " + s.model : "")}
              </Text>
            </Box>
            <Text color="secondary60">›</Text>
          </Flex>
        </Box>
      ))}
    </Panel>
  );
}

function Conversation({ session, onBack }: { session: any; onBack: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState(false);
  const [needsHuman, setNeedsHuman] = useState(!!session.needsHuman);
  const [{ fetching: resolving }, updateSession] = useAction(api.chatSession.update);
  // @ts-ignore
  const [{ data, fetching, error }] = useFindMany(api.chatMessage, {
    filter: { sessionId: { equals: session.sessionId } },
    sort: { createdAt: "Ascending" },
    first: 500,
  });

  async function handleDelete() {
    setBusy(true); setActionErr(false);
    try {
      const ids = (data || []).map((m: any) => m.id);
      // @ts-ignore
      if (ids.length) await api.chatMessage.bulkDelete(ids);
      // @ts-ignore
      await api.chatSession.delete(session.id);
      onBack();
    } catch (e) {
      setActionErr(true); setBusy(false); setConfirming(false);
    }
  }

  async function markResolved() {
    setActionErr(false);
    // @ts-ignore
    const result = await updateSession({ id: session.id, needsHuman: false });
    if (result.error) setActionErr(true);
    else setNeedsHuman(false);
  }

  function exportCsv() {
    const rows = [["role", "content", "time"]].concat(
      (data || []).map((m: any) => [m.role, m.content || "", fmtDate(m.createdAt)])
    );
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "conversation-" + session.sessionId + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const meta = [session.provider, session.model].filter(Boolean).join(" · ");

  return (
    <Panel header="Conversation" description={"Started " + fmtDate(session.createdAt) + (meta ? " · " + meta : "")}>
      <Flex justifyContent="space-between" alignItems="center" marginBottom="small" flexGap="8px" flexWrap="wrap">
        <Button variant="subtle" onClick={onBack}>← Back</Button>
        <Flex flexGap="8px">
          <Button variant="secondary" onClick={exportCsv} disabled={!data || data.length === 0}>Export CSV</Button>
          {!confirming ? (
            <Button actionType="destructive" variant="subtle" onClick={() => setConfirming(true)}>Delete</Button>
          ) : (
            <>
              <Button actionType="destructive" onClick={handleDelete} isLoading={busy}>Confirm delete</Button>
              <Button variant="subtle" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            </>
          )}
        </Flex>
      </Flex>

      {actionErr && <Message type="error" messages={[{ text: "Action failed. Please try again." }]} marginVertical="small" />}
      {needsHuman && (
        <Box border="box" borderRadius="normal" padding="small" marginBottom="small" backgroundColor="warning10">
          <Flex justifyContent="space-between" alignItems="flex-start" flexGap="12px" flexWrap="wrap">
            <Box style={{ minWidth: 0 }}>
              <Text bold marginBottom="xxSmall">
                {"Handoff requested " + fmtDate(session.handoffAt)}
              </Text>
              <Text marginBottom="xxSmall">
                {"Reply to: "}
                <a href={"mailto:" + session.handoffEmail}>{session.handoffEmail}</a>
              </Text>
              <Text marginBottom="none" style={{ whiteSpace: "pre-wrap" }}>{session.handoffSummary}</Text>
            </Box>
            <Button variant="secondary" onClick={markResolved} isLoading={resolving}>Mark resolved</Button>
          </Flex>
        </Box>
      )}
      {fetching && <Text color="secondary60">Loading…</Text>}
      {error && <Message type="error" messages={[{ text: "Couldn't load this conversation." }]} />}

      {(data || []).map((m: any) => {
        const isUser = m.role === "user";
        return (
          <Flex key={m.id} flexDirection="column" alignItems={isUser ? "flex-end" : "flex-start"} marginBottom="small">
            <Box
              padding="small"
              style={{
                maxWidth: "80%",
                borderRadius: 14,
                background: isUser ? "#ef6526" : "#f1f2f4",
                color: isUser ? "#fff" : "#1a1a1a",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {m.content ? <Text marginBottom="none" style={{ color: "inherit" }}>{m.content}</Text> : null}
              {Array.isArray(m.images) && m.images.length > 0 && (
                <Flex flexWrap="wrap" flexGap="6px" style={{ marginTop: m.content ? 6 : 0 }}>
                  {m.images.map((src: string, i: number) => (
                    <img key={i} src={src} style={{ maxWidth: 140, maxHeight: 140, borderRadius: 8, display: "block" }} />
                  ))}
                </Flex>
              )}
            </Box>
            <Text color="secondary60" marginBottom="none" style={{ fontSize: 11, marginTop: 2 }}>{fmtDate(m.createdAt)}</Text>
          </Flex>
        );
      })}
    </Panel>
  );
}
