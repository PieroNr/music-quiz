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

function FadeSection({
                         show,
                         children,
                         className = "",
                     }: {
    show: boolean;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={[
                "transition-opacity duration-300",
                show ? "opacity-100" : "opacity-0 pointer-events-none",
                className,
            ].join(" ")}
        >
            {children}
        </div>
    );
}

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
    const [code, setCode] = useState<string | null>(null);

    // Connexion
    const [name, setName] = useState("");
    const [joined, setJoined] = useState<Joined | null>(null);
    const [loadingJoin, setLoadingJoin] = useState(false);

    // Jeu
    const [round, setRound] = useState<RoundPayload | null>(null);
    const [picked, setPicked] = useState<0 | 1 | 2 | 3 | null>(null);
    const [ended, setEnded] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    // Temps
    const [now, setNow] = useState(() => Date.now());

    // Récupérer le code depuis l'URL
    useEffect(() => {
        params.then((p) => setCode(p.code));
    }, [params]);

    // Restaurer le joueur
    useEffect(() => {
        if (!code) return;
        const pid = localStorage.getItem(`mq:${code}:playerId`);
        const nm = localStorage.getItem(`mq:${code}:name`);
        if (pid && nm) setJoined({ playerId: pid, name: nm });
    }, [code]);

    // Horloge UI
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(id);
    }, []);

    // Temps réel (Pusher)
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
        if (!round) return "ATTENTE";
        if (now < round.answerStartAt) return "ECOUTE";
        if (now >= round.answerStartAt && now <= round.endsAt) return "REPONSE";
        return "TERMINE";
    }, [round, now]);

    const secondesAvantReponse = round ? Math.max(0, Math.ceil((round.answerStartAt - now) / 1000)) : 0;
    const secondesRestantes = round ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0;

    const progressReponse = useMemo(() => {
        if (!round) return 0;
        const total = round.endsAt - round.answerStartAt;
        const restant = round.endsAt - now;
        return clamp(restant / total, 0, 1);
    }, [round, now]);

    async function answer(choiceIndex: 0 | 1 | 2 | 3) {
        if (!code || !round || !joined) return;
        if (phase !== "REPONSE") return;

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

    const labelDifficulte = round ? `Difficulté ${round.difficulty}` : "";

    // visibilité des sous-états
    const showWaiting = joined && !round;
    const showListening = joined && round && phase === "ECOUTE";
    const showAnswering = joined && round && phase === "REPONSE";
    const showAfter = joined && round && phase === "TERMINE";
    const showResult = joined && !!ended;

    if (!code) {
        return (
            <main className="min-h-screen bg-[#0E0E11] text-[#F2F2F2] p-6">
                Chargement…
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-[#0E0E11] text-[#F2F2F2]">
            {/* Fond grille tekno */}
            <div
                className="pointer-events-none fixed inset-0"
                style={{
                    backgroundImage:
                        "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
                    backgroundSize: "40px 40px",
                }}
            />

            <div className="relative mx-auto max-w-md px-4 pb-6 pt-4">
                {/* Barre du haut */}
                <div className="flex items-center justify-between border border-white/10 bg-[#0E0E11]/70 px-4 py-3">
                    <div className="text-[10px] tracking-[0.35em] text-white/60">JOUEUR</div>

                    <div className="flex items-center gap-3">
                        <div className="text-[10px] tracking-[0.35em] text-white/60">CODE</div>
                        <div className="border border-white/15 bg-[#1A1A1F] px-3 py-1 font-mono text-sm tracking-[0.25em]">
                            {code}
                        </div>
                    </div>

                    <div className="hidden sm:block text-[10px] tracking-[0.35em] text-white/60">
                        {labelDifficulte}
                    </div>
                </div>

                {/* Bloc connexion */}
                {!joined && (
                    <div className="mt-5 border border-white/10 bg-[#1A1A1F] p-5">
                        <div className="text-[10px] tracking-[0.35em] text-white/60">IDENTITÉ</div>
                        <div className="mt-2 text-lg font-semibold">Entre ton pseudo</div>

                        <input
                            className="mt-4 w-full border border-white/10 bg-[#0E0E11] px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Pseudo"
                            maxLength={24}
                        />

                        <button
                            onClick={join}
                            disabled={loadingJoin || !name.trim()}
                            className="mt-4 w-full border border-white/20 bg-[#F2F2F2] px-4 py-3 text-sm font-semibold tracking-wide text-black disabled:opacity-50"
                        >
                            {loadingJoin ? "Connexion…" : "Rejoindre"}
                        </button>

                        {error && <p className="mt-3 text-sm text-[#FF3D3D]">{error}</p>}
                    </div>
                )}

                {joined && (
                    <>
                        {/* Bloc statut — HAUTEUR FIXE */}
                        <div className="mt-5 border border-white/10 bg-[#1A1A1F] p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[10px] tracking-[0.35em] text-white/60">CONNECTÉ EN TANT QUE</div>
                                    <div className="mt-1 truncate text-lg font-semibold">{joined.name}</div>
                                </div>

                                <div className="text-right">
                                    <div className="text-[10px] tracking-[0.35em] text-white/60">ÉTAT</div>
                                    <div className="mt-1 text-sm font-semibold tracking-wide">
                                        {phase === "ATTENTE" && "EN ATTENTE"}
                                        {phase === "ECOUTE" && "ÉCOUTE"}
                                        {phase === "REPONSE" && "RÉPONDS"}
                                        {phase === "TERMINE" && "FINI"}
                                    </div>
                                </div>
                            </div>

                            {/* Zone message + timer : hauteur fixe pour éviter les sauts */}
                            <div className="mt-4 border-t border-white/10 pt-3">
                                <div className="relative h-[104px]">
                                    {/* ATTENTE */}
                                    <FadeSection show={!!showWaiting} className="absolute inset-0">
                                        <div className="text-sm text-white/75">En attente de la prochaine manche…</div>
                                        <div className="mt-3 text-[10px] tracking-[0.35em] text-white/50">
                                            Garde l&apos;écran ouvert
                                        </div>
                                    </FadeSection>

                                    {/* ÉCOUTE */}
                                    <FadeSection show={!!showListening} className="absolute inset-0">
                                        <div className="text-sm text-white/80">Écoute bien, les réponses arrivent…</div>

                                        <div className="mt-3 flex items-center justify-between">
                                            <div className="text-[10px] tracking-[0.35em] text-white/60">DÉBUT DANS</div>
                                            <div className="font-mono text-2xl tracking-[0.25em]">
                                                {secondesAvantReponse.toString().padStart(2, "0")}
                                            </div>
                                        </div>

                                        <div className="mt-3 h-1 w-full bg-white/10">
                                            <div className="h-1 w-0 bg-[#5B3DF5]" />
                                        </div>
                                    </FadeSection>

                                    {/* RÉPONSE */}
                                    <FadeSection show={!!showAnswering} className="absolute inset-0">
                                        <div className="flex items-center justify-between">
                                            <div className="text-[10px] tracking-[0.35em] text-white/60">TEMPS RESTANT</div>
                                            <div
                                                className={[
                                                    "font-mono text-3xl tracking-[0.25em]",
                                                    secondesRestantes <= 3 ? "text-[#FF3D3D]" : "text-[#F2F2F2]",
                                                ].join(" ")}
                                            >
                                                {secondesRestantes.toString().padStart(2, "0")}
                                            </div>
                                        </div>

                                        <div className="mt-3 h-1 w-full bg-white/10">
                                            <div className="h-1 bg-[#5B3DF5]" style={{ width: `${progressReponse * 100}%` }} />
                                        </div>

                                        <div className="mt-2 text-sm text-white/70">
                                            {picked === null ? "Choisis A / B / C / D" : "Réponse enregistrée"}
                                        </div>
                                    </FadeSection>

                                    {/* FINI */}
                                    <FadeSection show={!!showAfter} className="absolute inset-0">
                                        <div className="text-sm text-white/75">Temps écoulé.</div>
                                        <div className="mt-3 text-[10px] tracking-[0.35em] text-white/50">
                                            Attente du résultat
                                        </div>
                                    </FadeSection>
                                </div>
                            </div>
                        </div>

                        {/* Boutons 2x2 — HAUTEUR FIXE */}
                        <div className="mt-4">
                            <div className="grid grid-cols-2 gap-3">
                                {(["A", "B", "C", "D"] as const).map((label, i) => {
                                    const isSelected = picked === i;
                                    const disabled = phase !== "REPONSE" || picked !== null;

                                    return (
                                        <button
                                            key={label}
                                            onClick={() => answer(i as 0 | 1 | 2 | 3)}
                                            disabled={disabled}
                                            className={[
                                                "border px-4 py-4 text-left", // plus compact
                                                "h-[92px]", // hauteur fixe par bouton
                                                "bg-[#0E0E11] border-white/15",
                                                "transition duration-200 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100",
                                                "focus:outline-none focus:ring-2 focus:ring-white/20",
                                                isSelected ? "bg-[#5B3DF5] text-black border-white/30" : "hover:border-white/30",
                                            ].join(" ")}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="text-4xl font-semibold leading-none">{label}</div>
                                                <div className="text-[10px] tracking-[0.35em] opacity-70">
                                                    {isSelected ? "VALIDÉ" : "CHOISIR"}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Zone message erreur / confirmation : hauteur fixe + fade */}
                            <div className="relative mt-3 h-[44px]">
                                <FadeSection show={picked !== null} className="absolute inset-0">
                                    <div className="border border-white/10 bg-[#1A1A1F] p-3 text-sm text-white/80">
                                        Réponse envoyée.
                                    </div>
                                </FadeSection>

                                <FadeSection show={!!error} className="absolute inset-0">
                                    <div className="border border-white/10 bg-[#1A1A1F] p-3 text-sm text-[#FF3D3D]">
                                        {error}
                                    </div>
                                </FadeSection>
                            </div>
                        </div>

                        {/* Résultat — HAUTEUR FIXE + fade */}
                        <div className="relative mt-4 h-[132px]">
                            <FadeSection show={!!showResult} className="absolute inset-0">
                                <div className="border border-white/10 bg-[#1A1A1F] p-4">
                                    <div className="text-[10px] tracking-[0.35em] text-white/60">RÉSULTAT</div>

                                    <div className="mt-2 text-base">
                                        Bonne réponse :{" "}
                                        <span className="bg-[#5B3DF5] px-2 py-1 font-semibold text-black">
                      {ended ? ["A", "B", "C", "D"][ended.correctIndex] : "—"}
                    </span>
                                    </div>

                                    <div className="mt-2 text-sm text-white/80">
                                        Ton choix :{" "}
                                        <span className="font-semibold">
                      {picked === null ? "—" : ["A", "B", "C", "D"][picked]}
                    </span>
                                    </div>

                                    <div className="mt-3 text-[10px] tracking-[0.35em] text-white/50">
                                        PROCHAINE MANCHE BIENTÔT
                                    </div>
                                </div>
                            </FadeSection>

                            {/* Placeholder invisible pour garder la hauteur même sans résultat */}
                            <FadeSection show={!showResult} className="absolute inset-0">
                                <div className="border border-white/10 bg-[#1A1A1F] p-4 opacity-0">
                                    placeholder
                                </div>
                            </FadeSection>
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}