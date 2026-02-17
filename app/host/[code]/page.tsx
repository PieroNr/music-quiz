"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { makePusherClient } from "@/lib/pusher-client";

type Player = { id: string; name: string; avatarDataUrl?: string | null; joinedAt: number };

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

    // audio (hidden) + visualizer
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const srcNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const rafRef = useRef<number | null>(null);
    const isDrawingRef = useRef(false);

    // ✅ lettre affichée derrière le spectre
    const [currentSegment, setCurrentSegment] = useState<"—" | "Q" | "A" | "B" | "C" | "D">("—");

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

    // init visualizer (AudioContext + analyser)
    function ensureAudioGraph() {
        const audioEl = audioRef.current;
        if (!audioEl) return;

        if (!audioCtxRef.current) {
            const Ctx = window.AudioContext || (window as any).webkitAudioContext;
            audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current;

        if (ctx.state === "suspended") {
            // iOS/Safari: doit être réveillé sur geste utilisateur (bouton "Lancer une manche")
            ctx.resume().catch(() => {});
        }

        if (!analyserRef.current) {
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.85;
            analyserRef.current = analyser;
        }

        // MediaElementAudioSourceNode ne peut être créé qu’une fois par <audio>
        if (!srcNodeRef.current) {
            srcNodeRef.current = ctx.createMediaElementSource(audioEl);
            srcNodeRef.current.connect(analyserRef.current!);
            analyserRef.current!.connect(ctx.destination);
        }
    }

    function stopDrawing() {
        isDrawingRef.current = false;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx2d = canvas.getContext("2d");
        if (!ctx2d) return;

        const rect = canvas.getBoundingClientRect();
        ctx2d.clearRect(0, 0, rect.width, rect.height);
    }

    function startDrawing() {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;

        const ctx2d = canvas.getContext("2d");
        if (!ctx2d) return;

        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = Math.floor(rect.width * dpr);
            canvas.height = Math.floor(rect.height * dpr);
            ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();

        const onResize = () => resize();
        window.addEventListener("resize", onResize);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        isDrawingRef.current = true;

        const draw = () => {
            if (!isDrawingRef.current) {
                window.removeEventListener("resize", onResize);
                return;
            }

            analyser.getByteFrequencyData(dataArray);

            const w = canvas.getBoundingClientRect().width;
            const h = canvas.getBoundingClientRect().height;

            ctx2d.clearRect(0, 0, w, h);

            // base line
            ctx2d.fillStyle = "rgba(255,255,255,0.06)";
            ctx2d.fillRect(0, h - 2, w, 2);

            // bars
            const barCount = 64;
            const step = Math.floor(bufferLength / barCount);
            const gap = 3;
            const barW = (w - gap * (barCount - 1)) / barCount;

            for (let i = 0; i < barCount; i++) {
                const v = dataArray[i * step] / 255;
                const scaled = Math.pow(v, 1.6);

                const barH = Math.max(6, scaled * (h - 12));
                const x = i * (barW + gap);
                const y = h - barH;

                ctx2d.fillStyle = "rgba(91,61,245,0.85)";
                ctx2d.fillRect(x, y, barW, barH);

                ctx2d.fillStyle = "rgba(242,242,242,0.35)";
                ctx2d.fillRect(x, y, barW, 2);
            }

            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
    }

    // initial load players
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
            setCurrentSegment("—");
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
            setCurrentSegment("—");
        });

        return () => {
            channel.unbind_all();
            pusher.unsubscribe(`room-${code}`);
            pusher.disconnect();
        };
    }, [code]);

    // audio helpers
    async function playUrl(url: string, segment: "Q" | "A" | "B" | "C" | "D") {
        const el = audioRef.current;
        if (!el) return;

        ensureAudioGraph();

        setCurrentSegment(segment);

        el.src = url;
        el.load();

        const started = new Promise<void>((resolve) => {
            const onPlay = () => resolve();
            el.addEventListener("playing", onPlay, { once: true });
        });

        await el.play();
        await started;

        startDrawing();

        await new Promise<void>((resolve) => {
            el.onended = () => resolve();
        });

        stopDrawing();
        setCurrentSegment("—");
    }

    async function playSequence(questionUrl: string, optionUrls: string[]) {
        // question
        await playUrl(questionUrl, "Q");

        // A/B/C/D each preceded by 3 seconds gap
        const labels: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];
        for (let i = 0; i < optionUrls.length; i++) {
            await wait(3000);
            await playUrl(optionUrls[i], labels[i] ?? "A");
        }
    }

    // start round (host action)
    async function startRound() {
        if (!code) return;
        setError(null);

        try {
            // wake audio context on user gesture
            ensureAudioGraph();

            const res = await fetch(`/api/room/${code}/round/start`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Erreur start round");

            setRound(data);
            setAnswers({});
            setEnded(null);
            setCurrentSegment("—");

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
            setCurrentSegment("—");
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

    // cleanup on unmount
    useEffect(() => {
        return () => {
            stopDrawing();
            const a = audioRef.current;
            if (a) {
                a.pause();
                a.src = "";
            }
            const ctx = audioCtxRef.current;
            if (ctx) ctx.close().catch(() => {});
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            <div className="flex items-center justify-between border border-white/10 bg-[#0E0E11]/60 px-6 py-4">
                <div className="text-xs tracking-[0.3em] text-white/60">HOST</div>

                <div className="flex items-center gap-4">
                    <div className="text-xs tracking-[0.3em] text-white/60">ROOM</div>
                    <div className="border border-white/15 bg-[#1A1A1F] px-5 py-2 font-mono text-xl tracking-[0.25em]">
                        {code}
                    </div>
                </div>

                <button
                    onClick={startRound}
                    className="border border-white/20 bg-[#F2F2F2] px-6 py-3 text-sm font-semibold tracking-wide text-black hover:bg-white"
                >
                    LANCER UNE MANCHE
                </button>
            </div>

            {error && <p className="mt-4 text-red-400">{error}</p>}

            {/* MAIN GRID */}
            <div className="mt-8 grid grid-cols-12 gap-6">
                {/* LEFT: QR + Players */}
                <div className="col-span-3 space-y-6">
                    <div className="border border-white/15 bg-[#1A1A1F] p-5 rounded-none">
                        <div className="text-xs tracking-[0.35em] text-white/60">REJOINDRE</div>
                        <div className="mt-3 flex items-start gap-4">
                            <canvas ref={qrCanvasRef} className="border border-white/10 bg-white p-2 rounded-none" />
                            <div className="min-w-0">
                                <div className="text-[10px] tracking-[0.35em] text-white/60">LIEN</div>
                                <div className="mt-1 break-all font-mono text-xs text-white/80">{joinFullUrl}</div>
                                <button
                                    onClick={() => navigator.clipboard.writeText(joinFullUrl)}
                                    className="mt-3 border border-white/10 bg-[#0E0E11] px-3 py-2 text-sm rounded-none"
                                >
                                    Copier
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="border border-white/15 bg-[#1A1A1F] p-5 rounded-none">
                        <div className="flex items-center justify-between">
                            <div className="text-xs tracking-[0.35em] text-white/60">JOUEURS</div>
                            <div className="border border-white/10 bg-[#0E0E11] px-3 py-1 font-mono text-sm rounded-none">
                                {players.length}
                            </div>
                        </div>

                        <div className="mt-4 space-y-2 max-h-[48vh] overflow-auto pr-1">
                            {players.map((p) => (
                                <div key={p.id} className="flex items-center gap-3 border border-white/10 bg-[#0E0E11] px-3 py-2 rounded-none">
                                    <div className="h-10 w-10 overflow-hidden border border-white/10 bg-black rounded-none">
                                        {p.avatarDataUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={p.avatarDataUrl} alt={p.name} className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="h-full w-full flex items-center justify-center text-xs text-white/50">
                                                {p.name?.slice(0, 1)?.toUpperCase() ?? "?"}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-white">{p.name}</div>
                                </div>
                            ))}
                            {players.length === 0 && <div className="text-white/60">En attente de joueurs…</div>}
                        </div>
                    </div>
                </div>

                {/* CENTER: Timer + status + VISUALIZER */}
                <div className="col-span-6 space-y-6">
                    <div className="border border-white/15 bg-[#1A1A1F] p-10 text-center rounded-none">
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
                                <div
                                    className={[
                                        "mt-5 text-7xl font-mono tracking-widest",
                                        secondsLeft <= 3 ? "text-red-400" : "text-white",
                                    ].join(" ")}
                                >
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
                                        className="mt-5 border border-white/10 bg-[#0E0E11] px-5 py-3 rounded-none"
                                    >
                                        Calculer résultat
                                    </button>
                                )}
                            </>
                        )}

                        {/* ✅ Visualiseur + lettre en fond */}
                        <div className="mt-8">
                            <div className="text-[10px] tracking-[0.35em] text-white/50">SPECTRE</div>

                            <div className="mt-3 h-[180px] w-full border border-white/10 bg-[#0E0E11] p-3 relative overflow-hidden rounded-none">
                                {/* lettre en fond */}
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="font-mono text-[120px] leading-none tracking-[0.15em] text-white/10 select-none">
                                        {currentSegment}
                                    </div>
                                </div>

                                <canvas ref={canvasRef} className="h-full w-full relative z-10" />
                            </div>

                            <div className="mt-3 text-xs text-white/50">
                                (Lecture en cours — lecteur audio caché)
                            </div>
                        </div>

                        {/* audio caché */}
                        <audio ref={audioRef} className="hidden" />
                    </div>

                    {ended && (
                        <div className="border border-white/15 bg-[#1A1A1F] p-6 rounded-none">
                            <div className="text-xs tracking-[0.35em] text-white/60">RÉSULTAT</div>
                            <div className="mt-2 text-xl">
                                Bonne réponse : <b>{ended.correctLabel}</b>
                            </div>

                            <div className="mt-5">
                                <div className="text-xs tracking-[0.35em] text-white/60">CLASSEMENT</div>
                                <div className="mt-3 space-y-2">
                                    {ended.leaderboard?.slice(0, 10).map((p: any, idx: number) => (
                                        <div
                                            key={p.id}
                                            className="flex items-center justify-between border border-white/10 bg-[#0E0E11] px-4 py-3 rounded-none"
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
                    <div className="border border-white/15 bg-[#1A1A1F] p-5 rounded-none">
                        <div className="text-xs tracking-[0.35em] text-white/60">RÉPONSES</div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                            {(["A", "B", "C", "D"] as const).map((label, i) => (
                                <div key={label} className="border border-white/10 bg-[#0E0E11] p-5 rounded-none">
                                    <div className="flex items-center justify-between">
                                        <div className="text-3xl font-semibold">{label}</div>
                                        <div className="border border-white/10 bg-white/5 px-3 py-1 font-mono rounded-none">
                                            {counts[i]}
                                        </div>
                                    </div>

                                    <div className="mt-4 h-2 w-full bg-white/10">
                                        <div
                                            className="h-2 bg-white/50"
                                            style={{
                                                width: `${players.length ? (counts[i] / players.length) * 100 : 0}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-5 text-xs text-white/50">
                            Astuce: tu peux relancer une nouvelle manche à tout moment.
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}