"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { makePusherClient } from "@/lib/pusher-client";

type Player = { id: string; name: string; joinedAt: number };

type RoundPayload = {
    roundId: string;
    difficulty: 1 | 2 | 3;
    questionUrl: string;
    optionUrls: string[];
    sequenceStartAt: number;
    answerStartAt: number;
    endsAt: number;
};

function wait(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export default function HostRoomPage({ params }: { params: Promise<{ code: string }> }) {
    const [code, setCode] = useState<string | null>(null);

    // players
    const [players, setPlayers] = useState<Player[]>([]);
    const [error, setError] = useState<string | null>(null);

    // round
    const [round, setRound] = useState<RoundPayload | null>(null);
    const [answers, setAnswers] = useState<Record<string, number>>({});
    const [ended, setEnded] = useState<any>(null);

    // timer
    const [now, setNow] = useState(() => Date.now());

    // audio (host plays sequence)
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // qr
    const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const [joinFullUrl, setJoinFullUrl] = useState<string>("");

    // unwrap params
    useEffect(() => {
        params.then((p) => setCode(p.code));
    }, [params]);

    // clock tick
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(id);
    }, []);

    // build join url
    useEffect(() => {
        if (!code) return;
        setJoinFullUrl(`${window.location.origin}/join/${code}`);
    }, [code]);

    // draw qr
    useEffect(() => {
        if (!joinFullUrl || !qrCanvasRef.current) return;
        QRCode.toCanvas(qrCanvasRef.current, joinFullUrl, { width: 220, margin: 1 }).catch(() => {});
    }, [joinFullUrl]);

    // initial load players (one-time fetch, then realtime adds)
    async function refreshPlayers() {
        if (!code) return;
        try {
            const res = await fetch(`/api/room/${code}/players`);
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Erreur chargement joueurs");
            setPlayers(data.players ?? []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Erreur inconnue");
        }
    }

    useEffect(() => {
        if (code) refreshPlayers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code]);

    // pusher realtime
    useEffect(() => {
        if (!code) return;

        const pusher = makePusherClient();
        const channel = pusher.subscribe(`room-${code}`);

        channel.bind("player-joined", (payload: any) => {
            setPlayers((prev) => {
                if (prev.some((p) => p.id === payload.id)) return prev;
                return [...prev, payload].sort((a, b) => a.joinedAt - b.joinedAt);
            });
        });

        channel.bind("round-started", (payload: RoundPayload) => {
            setRound(payload);
            setAnswers({});
            setEnded(null);
            setError(null);

            // Start audio sequence on host
            playSequence(payload.questionUrl, payload.optionUrls).catch(() => {});
        });

        channel.bind("player-answered", (payload: any) => {
            setAnswers((prev) => {
                if (payload?.playerId) return { ...prev, [payload.playerId]: payload.choiceIndex };
                return prev;
            });
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

    // audio helpers
    async function playUrl(url: string) {
        const el = audioRef.current;
        if (!el) return;

        el.src = url;
        el.load();
        await el.play();

        await new Promise<void>((resolve) => {
            el.onended = () => resolve();
        });
    }

    async function playSequence(questionUrl: string, optionUrls: string[]) {
        // question
        await playUrl(questionUrl);

        // A/B/C/D each preceded by 3 seconds gap
        for (const url of optionUrls) {
            await wait(3000);
            await playUrl(url);
        }
    }

    // start round (host action)
    async function startRound() {
        if (!code) return;
        setError(null);

        try {
            const res = await fetch(`/api/room/${code}/round/start`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Erreur start round");
            // We also set locally in case pusher is delayed
            setRound(data);
            setAnswers({});
            setEnded(null);

            // Launch audio sequence right away (also will run on round-started event)
            playSequence(data.questionUrl, data.optionUrls).catch(() => {});
        } catch (e) {
            setError(e instanceof Error ? e.message : "Erreur inconnue");
        }
    }

    // end round (host action + auto)
    async function endRound(roundId: string) {
        if (!code) return;
        try {
            const res = await fetch(`/api/room/${code}/round/end`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ roundId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Erreur end round");
            setEnded(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Erreur inconnue");
        }
    }

    // auto end when answer window hits 0
    useEffect(() => {
        if (!round) return;
        if (ended) return;
        if (now < round.endsAt) return;

        endRound(round.roundId).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [now, round, ended]);

    const phase = useMemo(() => {
        if (!round) return "IDLE";
        if (now < round.answerStartAt) return "LISTENING";
        if (now >= round.answerStartAt && now <= round.endsAt) return "ANSWERING";
        return "AFTER";
    }, [round, now]);

    const secondsToAnswerStart = round ? Math.max(0, Math.ceil((round.answerStartAt - now) / 1000)) : 0;
    const secondsLeft = round ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0;

    const counts = useMemo(() => {
        const c = [0, 0, 0, 0];
        for (const pid of Object.keys(answers)) {
            const v = answers[pid];
            if (v >= 0 && v <= 3) c[v] += 1;
        }
        return c;
    }, [answers]);

    if (!code) return <main className="min-h-screen bg-black text-white p-8">Chargement…</main>;

    return (
        <main className="min-h-screen bg-[#0B0B10] text-white p-8">
            {/* TOP BAR */}
            <div className="flex items-center justify-between">
                <div className="text-sm text-white/60">HOST</div>
                <div className="flex items-center gap-4">
                    <div className="text-white/60">CODE</div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 font-mono text-lg tracking-widest">
                        {code}
                    </div>
                </div>

                <button
                    onClick={startRound}
                    className="rounded-xl bg-white text-black px-5 py-3 font-semibold"
                >
                    Lancer une manche
                </button>
            </div>

            {error && <p className="mt-4 text-red-400">{error}</p>}

            {/* MAIN GRID */}
            <div className="mt-8 grid grid-cols-12 gap-6">
                {/* LEFT: QR + Players */}
                <div className="col-span-3 space-y-6">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                        <div className="text-sm text-white/70">Rejoindre</div>
                        <div className="mt-3 flex items-start gap-4">
                            <canvas ref={qrCanvasRef} className="rounded-xl border border-white/10 bg-white p-2" />
                            <div className="min-w-0">
                                <div className="text-xs text-white/60">Lien</div>
                                <div className="mt-1 break-all font-mono text-xs text-white/80">{joinFullUrl}</div>
                                <button
                                    onClick={() => navigator.clipboard.writeText(joinFullUrl)}
                                    className="mt-3 rounded-lg border border-white/10 bg-[#12121A] px-3 py-2 text-sm"
                                >
                                    Copier
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-white/70">Joueurs</div>
                            <div className="rounded-full border border-white/10 bg-[#12121A] px-3 py-1 font-mono text-sm">
                                {players.length}
                            </div>
                        </div>

                        <div className="mt-4 space-y-2 max-h-[48vh] overflow-auto pr-1">
                            {players.map((p) => (
                                <div key={p.id} className="rounded-xl border border-white/10 bg-[#12121A] px-3 py-2">
                                    <div className="text-white">{p.name}</div>
                                </div>
                            ))}
                            {players.length === 0 && <div className="text-white/60">En attente de joueurs…</div>}
                        </div>
                    </div>
                </div>

                {/* CENTER: Timer + status */}
                <div className="col-span-6 space-y-6">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-10 text-center">
                        {!round && <div className="text-white/70">Aucune manche en cours</div>}

                        {round && phase === "LISTENING" && (
                            <>
                                <div className="text-white/70">Écoute en cours…</div>
                                <div className="mt-5 text-6xl font-mono tracking-widest text-white">
                                    {secondsToAnswerStart.toString().padStart(2, "0")}
                                </div>
                                <div className="mt-3 text-white/60">Réponses dans (après A/B/C/D)</div>
                            </>
                        )}

                        {round && phase === "ANSWERING" && (
                            <>
                                <div className="text-white/70">Répondez maintenant</div>
                                <div className="mt-5 text-7xl font-mono tracking-widest text-white">
                                    {secondsLeft.toString().padStart(2, "0")}
                                </div>
                                <div className="mt-3 text-white/60">Fenêtre de réponse (10s)</div>
                            </>
                        )}

                        {round && phase === "AFTER" && (
                            <>
                                <div className="text-white/70">Terminé</div>
                                <div className="mt-5 text-6xl font-mono tracking-widest text-white/80">00</div>
                                {!ended && (
                                    <button
                                        onClick={() => endRound(round.roundId)}
                                        className="mt-5 rounded-xl border border-white/10 bg-[#12121A] px-5 py-3"
                                    >
                                        Calculer résultat
                                    </button>
                                )}
                            </>
                        )}

                        <audio ref={audioRef} controls className="mt-8 w-full opacity-90" />
                    </div>

                    {ended && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                            <div className="text-sm text-white/70">Résultat</div>
                            <div className="mt-2 text-xl">
                                Bonne réponse : <b>{ended.correctLabel}</b>
                            </div>

                            <div className="mt-5">
                                <div className="text-sm text-white/60">Classement</div>
                                <div className="mt-3 space-y-2">
                                    {ended.leaderboard?.slice(0, 10).map((p: any, idx: number) => (
                                        <div
                                            key={p.id}
                                            className="flex items-center justify-between rounded-xl border border-white/10 bg-[#12121A] px-4 py-3"
                                        >
                                            <div className="text-white/80">
                                                {idx + 1}. <span className="text-white">{p.name}</span>
                                            </div>
                                            <div className="font-mono text-white">{p.score}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* RIGHT: A/B/C/D columns */}
                <div className="col-span-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                        <div className="text-sm text-white/70">Réponses</div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                            {(["A", "B", "C", "D"] as const).map((label, i) => (
                                <div
                                    key={label}
                                    className="rounded-2xl border border-white/10 bg-[#12121A] p-5"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="text-3xl font-semibold">{label}</div>
                                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono">
                                            {counts[i]}
                                        </div>
                                    </div>

                                    <div className="mt-4 h-2 w-full rounded-full bg-white/10">
                                        <div
                                            className="h-2 rounded-full bg-white/50"
                                            style={{
                                                width: `${players.length ? (counts[i] / players.length) * 100 : 0}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-5 text-xs text-white/50">
                            Astuce: tu peux toujours cliquer “Lancer une manche” pour la suivante.
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}