"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Scorecards print through the browser rather than a PDF library: the print
 * stylesheet in globals.css strips the app chrome, so Ctrl+P (or this button)
 * produces a clean one-page PDF via the browser's own Save as PDF.
 */
export function PrintButton({ label = "Print / Save PDF" }: { label?: string }) {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="no-print">
      <Printer /> {label}
    </Button>
  );
}
