"use client";

type Props = {
    label: "A" | "B" | "C" | "D";
    onClick: () => void;
    disabled?: boolean;
    selected?: boolean;
};

export function AnswerButton({ label, onClick, disabled, selected }: Props) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={[
                "w-full rounded-2xl border px-4 py-6 text-left",
                "bg-[#12121A] border-white/10",
                "transition active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100",
                "focus:outline-none focus:ring-2 focus:ring-white/20",
                selected ? "border-white/40 bg-[#171723]" : "hover:border-white/20",
            ].join(" ")}
        >
            <div className="flex items-center justify-between">
                <div className="text-2xl font-semibold tracking-wide text-white">{label}</div>
                {selected && <div className="text-xs rounded-full bg-white/10 px-2 py-1 text-white/80">Choisi</div>}
            </div>
        </button>
    );
}