"use client";

import { useEffect, useMemo, useState } from "react";
import { makePusherClient } from "@/lib/pusher-client";
import { AnswerButton } from "@/components/AnswerButton";

type RoundPayload = {
    roundId: string;
    difficulty: 1 | 2 | 3;
    questionUrl: string;
    optionUrls: string[];
    sequenceStartAt: number;
    answerStartAt: number;
    endsAt: number;
};

type Joined = {
    playerId: string;
    name: string;
};

function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
}

export default function JoinPage({
                                     params,
                                 }: {
    params: Promise<{ code: string }>;
}) {
    const [code, setCode] = useState<string | null>(null);

    // Join state
    const [name, setName] = useState("");
    const [joined, setJoined] = useState<Joined | null>(null);
    const [loadingJoin, setLoadingJoin] = useState(false);

    // Gameplay state
    const [round, setRound] = useState<RoundPayload | null>(null);
    const [picked, setPicked] = useState<0 | 1 | 2 | 3 | null>(null);
    const [ended, setEnded] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    // Time
    const [now, setNow] = useState(() => Date.now());

    // Unwrap params
    useEffect(() => {
        params.then((p) => setCode(p.code));
    }, [params]);

    // Restore player from localStorage
    useEffect(() => {
        if (!code) return;
        const pid = localStorage.getItem(`mq:${code}:playerId`);
        const nm = localStorage.getItem(`mq:${code}:name`);
        if (pid && nm) setJoined({ playerId: pid, name: nm });
    }, [code]);

    // Clock tick
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(id);
    }, []);

    // Subscribe to Pusher
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

            const j = {
                playerId: data.playerId as string,
                name: data.name as string,
            };

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
        if (now >= round.answerStartAt && now <= round.endsAt)
            return "ANSWERING";
        return "AFTER";
    }, [round, now]);

    const secondsToAnswerStart = round
        ? Math.ceil((round.answerStartAt - now) / 1000)
        : 0;

    const secondsLeft = round
        ? Math.max(0, Math.ceil((round.endsAt - now) / 1000))
        : 0;

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

    if (!code)
        return (
            <main className="min-h-screen bg-[#0B0B10] text-white p-6">
                Chargement…
            </main>
        );

    return (
        <main className="min-h-screen bg-[#0B0B10] text-white">
            <div className="relative mx-auto max-w-md px-4 pb-10 pt-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="text-xs text-white/60">ROOM</div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-sm tracking-widest">
                        {code}
                    </div>
                    <div className="text-xs text-white/60">QUIZ</div>
                </div>

                {!joined && (
                    <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
                        <div className="text-lg font-semibold">
                            Rejoins la partie
                        </div>

                        <input
                            className="mt-4 w-full rounded-xl border border-white/10 bg-[#12121A] px-4 py-3 text-white"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Pseudo"
                            maxLength={24}
                        />

                        <button
                            onClick={join}
                            disabled={loadingJoin || !name.trim()}
                            className="mt-4 w-full rounded-xl bg-white text-black py-3 font-semibold disabled:opacity-50"
                        >
                            {loadingJoin ? "Connexion..." : "Rejoindre"}
                        </button>

                        {error && (
                            <p className="mt-3 text-sm text-red-400">
                                {error}
                            </p>
                        )}
                    </div>
                )}

                {joined && (
                    <>
                        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
                            <div className="text-sm text-white/60">
                                Connecté en tant que
                            </div>
                            <div className="mt-1 text-lg font-semibold">
                                {joined.name}
                            </div>

                            {!round && (
                                <div className="mt-4 text-white/70">
                                    En attente de la prochaine manche…
                                </div>
                            )}

                            {round && phase === "LISTENING" && (
                                <div className="mt-4">
                                    <div>Écoute bien…</div>
                                    <div className="mt-2 text-sm text-white/60">
                                        Réponses dans {Math.max(0, secondsToAnswerStart)}s
                                    </div>
                                </div>
                            )}

                            {round && phase === "ANSWERING" && (
                                <div className="mt-4 flex justify-between">
                                    <div>Réponds maintenant</div>
                                    <div className="font-mono">{secondsLeft}s</div>
                                </div>
                            )}
                        </div>

                        {round && (
                            <div className="mt-6 space-y-3">
                                {(["A", "B", "C", "D"] as const).map((label, i) => (
                                    <AnswerButton
                                        key={label}
                                        label={label}
                                        onClick={() => answer(i as 0 | 1 | 2 | 3)}
                                        disabled={phase !== "ANSWERING" || picked !== null}
                                        selected={picked === i}
                                    />
                                ))}
                            </div>
                        )}

                        {ended && (
                            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
                                Bonne réponse :{" "}
                                <b>{["A", "B", "C", "D"][ended.correctIndex]}</b>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}