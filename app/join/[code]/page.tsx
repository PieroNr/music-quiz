"use client";

import { useEffect, useMemo, useState } from "react";
import { makePusherClient } from "@/lib/pusher-client";

type RoundPayload = {
    roundId: string;
    difficulty: 1 | 2 | 3;
    questionUrl: string;
    optionUrls: string[];
    sequenceStartAt: number;
    answerStartAt: number;
    endsAt: number;
};

type Joined = { playerId: string; name: string };

function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
}

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
    const [code, setCode] = useState<string | null>(null);

    // join
    const [name, setName] = useState("");
    const [joined, setJoined] = useState<Joined | null>(null);
    const [loadingJoin, setLoadingJoin] = useState(false);

    // gameplay
    const [round, setRound] = useState<RoundPayload | null>(null);
    const [picked, setPicked] = useState<0 | 1 | 2 | 3 | null>(null);
    const [ended, setEnded] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    // time
    const [now, setNow] = useState(() => Date.now());

    // unwrap params
    useEffect(() => {
        params.then((p) => setCode(p.code));
    }, [params]);

    // restore player from localStorage
    useEffect(() => {
        if (!code) return;
        const pid = localStorage.getItem(`mq:${code}:playerId`);
        const nm = localStorage.getItem(`mq:${code}:name`);
        if (pid && nm) setJoined({ playerId: pid, name: nm });
    }, [code]);

    // clock tick
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(id);
    }, []);

    // subscribe pusher
    useEffect(() => {
        if (!code) return;

        const pusher = makePusherClient();
        const channel = pusher.subscribe(`room-${code}`);

        channel.bind("round-started", (payload: RoundPayload) => {
            setRound(payload);
            setPicked(null);
            setEnded(null);
            setError(null);
        });

        channel.bind("round-ended", (payload: any) => {
            setEnded(payload);
        });

        return () => {
            channel.unbind_all();
            pusher.unsubscribe(`room-${code}`);
            pusher.disconnect();
        };
    }, [code]);

    async function join() {
        if (!code) return;
        setLoadingJoin(true);
        setError(null);

        try {
            const res = await fetch(`/api/room/${code}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Impossible de rejoindre");

            const j = { playerId: data.playerId as string, name: data.name as string };
            setJoined(j);
            localStorage.setItem(`mq:${code}:playerId`, j.playerId);
            localStorage.setItem(`mq:${code}:name`, j.name);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Erreur inconnue");
        } finally {
            setLoadingJoin(false);
        }
    }

    const phase = useMemo(() => {
        if (!round) return "WAITING";
        if (now < round.answerStartAt) return "LISTENING";
        if (now >= round.answerStartAt && now <= round.endsAt) return "ANSWERING";
        return "AFTER";
    }, [round, now]);

    const secondsToAnswerStart = round ? Math.max(0, Math.ceil((round.answerStartAt - now) / 1000)) : 0;
    const secondsLeft = round ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0;

    const answerProgress = useMemo(() => {
        if (!round) return 0;
        const total = round.endsAt - round.answerStartAt;
        const remaining = round.endsAt - now;
        return clamp(remaining / total, 0, 1);
    }, [round, now]);

    async function answer(choiceIndex: 0 | 1 | 2 | 3) {
        if (!code || !round || !joined) return;
        if (phase !== "ANSWERING") return;

        setPicked(choiceIndex);
        setError(null);

        const res = await fetch(`/api/room/${code}/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                playerId: joined.playerId,
                roundId: round.roundId,
                choiceIndex,
            }),
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data?.error ?? "Erreur réponse");
            setPicked(null);
        }
    }

    const difficultyLabel = round ? `D${round.difficulty}` : "—";

    if (!code) {
        return (
            <main className="min-h-screen bg-[#0E0E11] text-[#F2F2F2] p-6">
                Chargement…
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-[#0E0E11] text-[#F2F2F2]">
            {/* tekno grid background */}
            <div
                className="pointer-events-none fixed inset-0 opacity-100"
                style={{
                    backgroundImage:
                        "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
                    backgroundSize: "40px 40px",
                }}
            />

            <div className="relative mx-auto max-w-md px-4 pb-10 pt-6">
                {/* Top bar */}
                <div className="flex items-center justify-between border border-white/10 bg-[#0E0E11]/60 px-4 py-3">
                    <div className="text-[10px] tracking-[0.35em] text-white/60">PLAYER</div>

                    <div className="flex items-center gap-3">
                        <div className="text-[10px] tracking-[0.35em] text-white/60">ROOM</div>
                        <div className="border border-white/15 bg-[#1A1A1F] px-3 py-1 font-mono text-sm tracking-[0.25em]">
                            {code}
                        </div>
                    </div>

                    <div className="border border-white/10 bg-[#1A1A1F] px-2 py-1 text-[10px] tracking-[0.35em] text-white/70">
                        {difficultyLabel}
                    </div>
                </div>

                {/* Join block */}
                {!joined && (
                    <div className="mt-8 border border-white/10 bg-[#1A1A1F] p-5">
                        <div className="text-xs tracking-[0.35em] text-white/60">IDENTITY</div>
                        <div className="mt-2 text-xl font-semibold tracking-tight">ENTRE TON PSEUDO</div>

                        <input
                            className="mt-5 w-full border border-white/10 bg-[#0E0E11] px-4 py-4 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Pseudo"
                            maxLength={24}
                        />

                        <button
                            onClick={join}
                            disabled={loadingJoin || !name.trim()}
                            className="mt-4 w-full border border-white/20 bg-[#F2F2F2] px-4 py-4 text-sm font-semibold tracking-wide text-black disabled:opacity-50"
                        >
                            {loadingJoin ? "CONNEXION…" : "REJOINDRE"}
                        </button>

                        {error && <p className="mt-3 text-sm text-[#FF3D3D]">{error}</p>}
                    </div>
                )}

                {joined && (
                    <>
                        {/* Status block */}
                        <div className="mt-8 border border-white/10 bg-[#1A1A1F] p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[10px] tracking-[0.35em] text-white/60">CONNECTED AS</div>
                                    <div className="mt-2 truncate text-xl font-semibold">{joined.name}</div>
                                </div>

                                <div className="text-right">
                                    <div className="text-[10px] tracking-[0.35em] text-white/60">STATUS</div>
                                    <div className="mt-2 text-sm font-semibold tracking-wide">
                                        {phase === "WAITING" && "WAIT"}
                                        {phase === "LISTENING" && "LISTEN"}
                                        {phase === "ANSWERING" && "ANSWER"}
                                        {phase === "AFTER" && "DONE"}
                                    </div>
                                </div>
                            </div>

                            {!round && (
                                <div className="mt-6 border-t border-white/10 pt-4 text-white/70">
                                    En attente de la prochaine manche…
                                </div>
                            )}

                            {round && phase === "LISTENING" && (
                                <div className="mt-6 border-t border-white/10 pt-4">
                                    <div className="text-sm text-white/80">Écoute. Les réponses arrivent.</div>

                                    <div className="mt-4 flex items-center justify-between">
                                        <div className="text-[10px] tracking-[0.35em] text-white/60">START IN</div>
                                        <div className="font-mono text-2xl tracking-[0.25em]">
                                            {secondsToAnswerStart.toString().padStart(2, "0")}
                                        </div>
                                    </div>

                                    <div className="mt-4 h-1 w-full bg-white/10">
                                        <div className="h-1 w-1/1 bg-[#5B3DF5]" />
                                    </div>
                                </div>
                            )}

                            {round && phase === "ANSWERING" && (
                                <div className="mt-6 border-t border-white/10 pt-4">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[10px] tracking-[0.35em] text-white/60">TIME LEFT</div>
                                        <div
                                            className={[
                                                "font-mono text-3xl tracking-[0.25em]",
                                                secondsLeft <= 3 ? "text-[#FF3D3D]" : "text-[#F2F2F2]",
                                            ].join(" ")}
                                        >
                                            {secondsLeft.toString().padStart(2, "0")}
                                        </div>
                                    </div>

                                    <div className="mt-4 h-1 w-full bg-white/10">
                                        <div className="h-1 bg-[#5B3DF5]" style={{ width: `${answerProgress * 100}%` }} />
                                    </div>

                                    {picked === null && <div className="mt-3 text-sm text-white/70">Choisis A / B / C / D</div>}
                                </div>
                            )}

                            {round && phase === "AFTER" && (
                                <div className="mt-6 border-t border-white/10 pt-4 text-white/70">
                                    Temps écoulé.
                                </div>
                            )}
                        </div>

                        {/* Answer buttons */}
                        {round && (
                            <div className="mt-6 space-y-3">
                                {(["A", "B", "C", "D"] as const).map((label, i) => {
                                    const isSelected = picked === i;
                                    const disabled = phase !== "ANSWERING" || picked !== null;

                                    return (
                                        <button
                                            key={label}
                                            onClick={() => answer(i as 0 | 1 | 2 | 3)}
                                            disabled={disabled}
                                            className={[
                                                "w-full border px-6 py-6 text-left",
                                                "bg-[#0E0E11] border-white/15",
                                                "transition active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100",
                                                "focus:outline-none focus:ring-2 focus:ring-white/20",
                                                isSelected ? "bg-[#5B3DF5] text-black border-white/30" : "hover:border-white/30",
                                            ].join(" ")}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="text-4xl font-semibold tracking-tight">{label}</div>
                                                <div className="text-[10px] tracking-[0.35em] opacity-70">
                                                    {isSelected ? "LOCKED" : "SELECT"}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}

                                {picked !== null && (
                                    <div className="border border-white/10 bg-[#1A1A1F] p-4 text-sm text-white/80">
                                        Réponse envoyée.
                                    </div>
                                )}

                                {error && <p className="text-sm text-[#FF3D3D]">{error}</p>}
                            </div>
                        )}

                        {/* Result */}
                        {ended && (
                            <div className="mt-6 border border-white/10 bg-[#1A1A1F] p-5">
                                <div className="text-[10px] tracking-[0.35em] text-white/60">RESULT</div>

                                <div className="mt-3 text-lg">
                                    Bonne réponse :{" "}
                                    <span className="bg-[#5B3DF5] px-2 py-1 font-semibold text-black">
                    {["A", "B", "C", "D"][ended.correctIndex]}
                  </span>
                                </div>

                                <div className="mt-3 text-white/80">
                                    Ton choix :{" "}
                                    <span className="font-semibold">
                    {picked === null ? "—" : ["A", "B", "C", "D"][picked]}
                  </span>
                                </div>

                                <div className="mt-5 text-xs tracking-[0.35em] text-white/50">
                                    NEXT ROUND SOON
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}