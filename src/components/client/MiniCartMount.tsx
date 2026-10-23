"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Renders its children into the side-cart container that the server-rendered shell provides. */
export function MiniCartMount({ children }: { children: React.ReactNode }) {
  const [el, setEl] = useState<Element | null>(null);
  useEffect(() => {
    const target = document.querySelector("[data-mini-cart]");
    if (target) {
      target.innerHTML = "";
      setEl(target);
    }
  }, []);
  return el ? createPortal(children, el) : null;
}
