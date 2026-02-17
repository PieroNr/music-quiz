"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function FadeSlideSection({
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
                "transition-all duration-300 ease-out",
                show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none",
                className,
            ].join(" ")}
        >
            {children}
        </div>
    );
}

// Compression simple: draw video frame -> canvas -> JPEG dataURL
async function captureAndCompressFromVideo(
    video: HTMLVideoElement,
    size = 128,
    quality = 0.75
): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible");

    // crop carré centré
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new Error("Flux vidéo non prêt");

    const side = Math.min(vw, vh);
    const sx = Math.floor((vw - side) / 2);
    const sy = Math.floor((vh - side) / 2);

    ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);

    return canvas.toDataURL("image/jpeg", quality);
}

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
    const [code, setCode] = useState<string | null>(null);

    // Connexion
    const [name, setName] = useState("");
    const [joined, setJoined] = useState<Joined | null>(null);
    const [loadingJoin, setLoadingJoin] = useState(false);

    // Avatar
    const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Jeu
    const [round, setRound] = useState<RoundPayload | null>(null);
    const [picked, setPicked] = useState<0 | 1 | 2 | 3 | null>(null);
    const [ended, setEnded] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    // Temps
    const [now, setNow] = useState(() => Date.now());

    // Haptique
    const didVibrateForRound = useRef<string | null>(null);

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
        const id = setInterval(() => setNow(Date.now()), 80);
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
            didVibrateForRound.current = null;
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

    // Vibrer quand on passe en REPONSE (1 fois / manche)
    const phase = useMemo(() => {
        if (!round) return "ATTENTE";
        if (now < round.answerStartAt) return "ECOUTE";
        if (now >= round.answerStartAt && now <= round.endsAt) return "REPONSE";
        return "TERMINE";
    }, [round, now]);

    useEffect(() => {
        if (!round) return;
        if (phase !== "REPONSE") return;
        if (didVibrateForRound.current === round.roundId) return;

        didVibrateForRound.current = round.roundId;

        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            navigator.vibrate?.([30, 40, 30]);
        }
    }, [phase, round]);

    const secondesAvantReponse = round ? Math.max(0, Math.ceil((round.answerStartAt - now) / 1000)) : 0;
    const secondesRestantes = round ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0;

    const progressReponse = useMemo(() => {
        if (!round) return 0;
        const total = round.endsAt - round.answerStartAt;
        const restant = round.endsAt - now;
        return clamp(restant / total, 0, 1);
    }, [round, now]);

    const progressEcoute = useMemo(() => {
        if (!round) return 0;
        const total = round.answerStartAt - round.sequenceStartAt;
        if (total <= 0) return 0;
        const elapsed = now - round.sequenceStartAt;
        return clamp(elapsed / total, 0, 1);
    }, [round, now]);

    async function join() {
        if (!code) return;
        setLoadingJoin(true);
        setError(null);

        try {
            const res = await fetch(`/api/room/${code}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, avatarDataUrl }),
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

    // Camera controls
    async function openCamera() {
        setCameraError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "user" },
                audio: false,
            });
            streamRef.current = stream;
            setCameraOpen(true);

            // attach stream
            const v = videoRef.current;
            if (v) {
                v.srcObject = stream;
                await v.play();
            }
        } catch (e) {
            setCameraError("Impossible d'accéder à la caméra (permission refusée ?).");
            setCameraOpen(false);
        }
    }

    function closeCamera() {
        setCameraOpen(false);
        const s = streamRef.current;
        if (s) {
            s.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
        const v = videoRef.current;
        if (v) v.srcObject = null;
    }

    async function takePhoto() {
        try {
            const v = videoRef.current;
            if (!v) return;
            const dataUrl = await captureAndCompressFromVideo(v, 128, 0.75);
            setAvatarDataUrl(dataUrl);
            closeCamera();
        } catch {
            setCameraError("Impossible de prendre la photo.");
        }
    }

    // cleanup camera on unmount
    useEffect(() => {
        return () => closeCamera();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const labelDifficulte = round ? `Difficulté ${round.difficulty}` : "";

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
        <main className="min-h-screen bg-[#0E0E11] text-[#F2F2F2] overflow-y-auto">
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

                        {/* Avatar picker */}
                        <div className="mt-4 flex items-center gap-4">
                            <div className="h-16 w-16 border border-white/15 bg-[#0E0E11] flex items-center justify-center overflow-hidden">
                                {avatarDataUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={avatarDataUrl} alt="Avatar" className="h-full w-full object-cover" />
                                ) : (
                                    <div className="text-[10px] tracking-[0.35em] text-white/50">PHOTO</div>
                                )}
                            </div>

                            <div className="flex-1">
                                <button
                                    type="button"
                                    onClick={openCamera}
                                    className="w-full border border-white/20 bg-[#0E0E11] px-4 py-3 text-sm font-semibold tracking-wide hover:border-white/35"
                                >
                                    Prendre une photo
                                </button>

                                {avatarDataUrl && (
                                    <button
                                        type="button"
                                        onClick={() => setAvatarDataUrl(null)}
                                        className="mt-2 w-full border border-white/10 bg-[#0E0E11] px-4 py-2 text-xs tracking-[0.25em] text-white/70 hover:border-white/25"
                                    >
                                        SUPPRIMER
                                    </button>
                                )}
                            </div>
                        </div>

                        {cameraError && <p className="mt-3 text-sm text-[#FF3D3D]">{cameraError}</p>}

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
                            className="mt-4 w-full border border-white/20 bg-[#F2F2F2] px-4 py-3 text-sm font-semibold tracking-wide text-black disabled:opacity-50 transition-transform active:scale-[0.99]"
                        >
                            {loadingJoin ? "Connexion…" : "Rejoindre"}
                        </button>

                        {error && <p className="mt-3 text-sm text-[#FF3D3D]">{error}</p>}
                    </div>
                )}

                {/* Modal caméra (simple) */}
                <FadeSlideSection show={cameraOpen} className="fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/70" onClick={closeCamera} />
                    <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 border border-white/10 bg-[#1A1A1F] p-4">
                        <div className="flex items-center justify-between">
                            <div className="text-[10px] tracking-[0.35em] text-white/60">CAMÉRA</div>
                            <button
                                onClick={closeCamera}
                                className="text-xs tracking-[0.25em] text-white/70 hover:text-white"
                            >
                                FERMER
                            </button>
                        </div>

                        <div className="mt-3 border border-white/10 bg-black">
                            <video ref={videoRef} playsInline className="w-full h-[320px] object-cover" />
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3">
                            <button
                                onClick={takePhoto}
                                className="border border-white/20 bg-[#F2F2F2] px-4 py-3 text-sm font-semibold tracking-wide text-black"
                            >
                                Prendre la photo
                            </button>
                            <button
                                onClick={closeCamera}
                                className="border border-white/20 bg-[#0E0E11] px-4 py-3 text-sm font-semibold tracking-wide"
                            >
                                Annuler
                            </button>
                        </div>
                    </div>
                </FadeSlideSection>

                {/* UI en jeu */}
                {joined && (
                    <>
                        {/* Bloc statut — hauteur fixe */}
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

                            <div className="mt-4 border-t border-white/10 pt-3">
                                <div className="relative h-[112px]">
                                    <FadeSlideSection show={!!showWaiting} className="absolute inset-0">
                                        <div className="text-sm text-white/75">En attente de la prochaine manche…</div>
                                        <div className="mt-3 text-[10px] tracking-[0.35em] text-white/50">
                                            Garde l&apos;écran ouvert
                                        </div>
                                    </FadeSlideSection>

                                    <FadeSlideSection show={!!showListening} className="absolute inset-0">
                                        <div className="text-sm text-white/80">Écoute bien, les réponses arrivent…</div>

                                        <div className="mt-3 flex items-center justify-between">
                                            <div className="text-[10px] tracking-[0.35em] text-white/60">DÉBUT DANS</div>
                                            <div className="font-mono text-2xl tracking-[0.25em]">
                                                {secondesAvantReponse.toString().padStart(2, "0")}
                                            </div>
                                        </div>

                                        <div className="mt-3 h-1 w-full bg-white/10">
                                            <div className="h-1 bg-[#5B3DF5]" style={{ width: `${progressEcoute * 100}%` }} />
                                        </div>

                                        <div className="mt-2 text-[10px] tracking-[0.35em] text-white/50">
                                            ÉCOUTE EN COURS
                                        </div>
                                    </FadeSlideSection>

                                    <FadeSlideSection show={!!showAnswering} className="absolute inset-0">
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
                                    </FadeSlideSection>

                                    <FadeSlideSection show={!!showAfter} className="absolute inset-0">
                                        <div className="text-sm text-white/75">Temps écoulé.</div>
                                        <div className="mt-3 text-[10px] tracking-[0.35em] text-white/50">
                                            Attente du résultat
                                        </div>
                                    </FadeSlideSection>
                                </div>
                            </div>
                        </div>

                        {/* Réponses 2x2 */}
                        {round && (
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
                                                    "border px-4 py-4 text-left h-[92px]",
                                                    "bg-[#0E0E11] border-white/15",
                                                    "transition-all duration-200",
                                                    "hover:-translate-y-[1px] hover:border-white/35",
                                                    "active:translate-y-0 active:scale-[0.99]",
                                                    "disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-white/15 disabled:active:scale-100",
                                                    "focus:outline-none focus:ring-2 focus:ring-white/20",
                                                    isSelected ? "bg-[#5B3DF5] text-black border-white/30" : "",
                                                ].join(" ")}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="text-4xl font-semibold leading-none">{label}</div>
                                                    <div className="text-[10px] tracking-[0.35em] opacity-70">
                                                        {isSelected ? "VALIDÉ" : "CHOISIR"}
                                                    </div>
                                                </div>

                                                <div className="mt-3 h-[2px] w-full bg-white/10">
                                                    <div
                                                        className={[
                                                            "h-[2px] transition-all duration-200",
                                                            isSelected ? "w-full bg-black/70" : "w-1/3 bg-[#5B3DF5]",
                                                        ].join(" ")}
                                                    />
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="relative mt-3 h-[44px]">
                                    <FadeSlideSection show={picked !== null} className="absolute inset-0">
                                        <div className="border border-white/10 bg-[#1A1A1F] p-3 text-sm text-white/80">
                                            Réponse envoyée.
                                        </div>
                                    </FadeSlideSection>

                                    <FadeSlideSection show={!!error} className="absolute inset-0">
                                        <div className="border border-white/10 bg-[#1A1A1F] p-3 text-sm text-[#FF3D3D]">
                                            {error}
                                        </div>
                                    </FadeSlideSection>
                                </div>
                            </div>
                        )}

                        {/* Résultat */}
                        <div className="relative mt-4 h-[132px]">
                            <FadeSlideSection show={!!showResult} className="absolute inset-0">
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
                            </FadeSlideSection>

                            <FadeSlideSection show={!showResult} className="absolute inset-0">
                                <div className="border border-white/10 bg-[#1A1A1F] p-4 opacity-0">placeholder</div>
                            </FadeSlideSection>
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}