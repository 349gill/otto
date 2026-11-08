import type { ImgHTMLAttributes } from "react";

export default function OttoLogo({
  className = "h-8 w-auto",
  alt = "Otto",
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      src="/otto-logo.svg"
      alt={alt}
      className={`otto-logo ${className}`}
      {...props}
    />
  );
}
