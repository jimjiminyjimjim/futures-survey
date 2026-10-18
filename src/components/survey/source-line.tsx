import Image from "next/image";
import { statementLogo } from "@/lib/survey/logos";

/**
 * An item's source line, e.g. "2a. Shein (2023)", with the organisation's
 * logo above it when it has one. The logo is decorative (the name is in
 * the text). Shared by the participant screen and the presentation slide.
 */
export function SourceLine({
  statementKey,
  label,
  context,
  className,
  logoClassName,
}: {
  statementKey: string;
  label: string | null;
  context: string | null;
  className?: string;
  /** Sizes the logo (height), e.g. "h-8". */
  logoClassName: string;
}) {
  const logo = statementLogo(statementKey);
  if (!label && !context) {
    return null;
  }
  if (!logo) {
    return (
      <p className={className}>{[label, context].filter(Boolean).join(". ")}</p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Image
        src={logo.src}
        alt=""
        width={logo.width}
        height={logo.height}
        unoptimized
        className={`w-auto ${logoClassName}`}
      />
      <p className={className}>{[label, context].filter(Boolean).join(". ")}</p>
    </div>
  );
}
