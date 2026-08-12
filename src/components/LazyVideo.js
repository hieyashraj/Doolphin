"use client";

import { useEffect, useRef, useState } from "react";

// Avoid assigning src until a card is close to the viewport. This prevents a
// library/explore grid from starting dozens of full MP4 transfers at once.
export default function LazyVideo({ src, className, autoPlay = false, controls = false, onClick, ...props }) {
  const containerRef = useRef(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !src) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [src]);

  return (
    <div ref={containerRef} className="relative h-full w-full bg-[#EDE9DE]" onClick={onClick}>
      {shouldLoad ? (
        <video
          src={src}
          className={className}
          autoPlay={autoPlay}
          controls={controls}
          muted={autoPlay ? true : props.muted}
          loop={autoPlay ? true : props.loop}
          playsInline
          preload="metadata"
          {...props}
        />
      ) : (
        <div aria-label="Video preview loading when visible" className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#EDE9DE] to-[#D8D1C0]" />
      )}
    </div>
  );
}
