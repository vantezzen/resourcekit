import { cn } from "@/lib/utils";
import type { Member } from "../data/resources";

function initials(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Avatar({
  member,
  size = "sm",
}: {
  member: Member | null | undefined;
  size?: "sm" | "md";
}) {
  const dimensions = size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs";

  if (!member) {
    return (
      <span
        title="Unassigned"
        className={cn(
          "inline-flex items-center justify-center rounded-full border border-dashed border-border text-muted-foreground",
          dimensions,
        )}
      >
        ?
      </span>
    );
  }

  return (
    <span
      title={member.name}
      style={{ backgroundColor: member.color }}
      className={cn(
        "inline-flex items-center justify-center rounded-full font-medium text-white",
        dimensions,
      )}
    >
      {initials(member.name)}
    </span>
  );
}
