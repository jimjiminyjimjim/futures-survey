"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";
import type { buttonVariants } from "@/components/ui/button";

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

/**
 * Shared navigation control for Begin/Back/Next and the review screen's
 * links. router.push happens inside its own useTransition so `disabled`
 * covers both an explicitly-passed pending state (e.g. a save in flight
 * elsewhere on the page) and this button's own navigation.
 */
export function NavButton({
  href,
  children,
  variant = "default",
  disabled = false,
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled || isPending}
      className={`h-11 px-4 text-base ${className ?? ""}`}
      onClick={() => {
        startTransition(() => {
          router.push(href);
        });
      }}
    >
      {children}
    </Button>
  );
}
