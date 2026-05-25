/**
 * ClothCraftLogo — the brand logomark as an inline SVG.
 *
 * Renders the interlinked fabric-loop icon at an arbitrary size while
 * preserving the original 578:395 aspect ratio. `color` is applied as
 * SVG fill so the logo can be tinted to match any background (white for
 * dark headers, purple for light backgrounds). A subtle drop-shadow filter
 * is baked into the SVG definition.
 */
import React from 'react';

const ClothCraftLogo = ({ size = 200, color = "white", className = "" }) => {
  // Height is derived from the original 578×395 viewBox aspect ratio.
  const height = (size * 395) / 578;

  return (
    <svg 
      width={size} 
      height={height} 
      viewBox="0 0 578 395" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <g filter="url(#filter0_d_93_111)">
        <path 
          fillRule="evenodd" 
          clipRule="evenodd" 
          d="M536.343 346.548C498.132 393.982 431.736 371.766 394.671 352.695C355.873 332.732 312.701 300.402 319.33 268.687C326.51 234.333 349.097 222.694 362.544 221.79C387.351 220.126 389.145 236.11 391.395 245.329C394.753 259.093 418.626 338.563 447.491 342.86C476.356 347.156 491.881 282.279 493.76 190.417C495.625 99.1993 478.583 36.371 456.908 37.5634C435.846 38.7219 421.695 62.5604 413.915 85.9193C405.122 112.321 402.372 144.255 390.575 152.306C379.151 160.787 339.94 151.649 323.424 107.638C306.949 63.7345 331.38 94.8185 379.111 59.2822C417.593 30.6317 455.432 -10.1917 494.988 2.32062C522.835 11.1299 566.892 71.954 572.377 157.633C577.787 242.165 570.628 303.988 536.343 346.548ZM396.896 184.167C396.896 184.167 346.124 186.481 319.359 213.242C292.482 240.115 289.614 291.437 289.614 291.437C289.614 291.437 285.627 238.346 258.698 211.42C231.987 184.712 182.331 184.167 182.331 184.167C182.331 184.167 232.1 182.189 258.864 155.428C285.741 128.554 289.614 76.898 289.614 76.898C289.617 76.8999 290.212 127.855 319.289 155.676C346.517 181.728 396.896 184.167 396.896 184.167ZM187.571 152.426C175.766 144.376 173.014 112.446 164.213 86.0477C156.428 62.6934 142.265 38.8567 121.185 37.6992C99.493 36.5076 82.4374 99.3268 84.3042 190.531C86.1848 282.382 101.722 347.25 130.61 342.953C159.499 338.658 183.39 259.199 186.751 245.436C189.003 236.218 190.8 220.236 215.624 221.901C229.084 222.804 251.688 234.442 258.875 268.792C265.508 300.501 222.302 332.827 183.473 352.787C146.379 371.856 79.9284 394.069 41.687 346.642C7.3747 304.087 0.209146 242.273 5.62528 157.752C11.1148 72.0852 55.2062 11.2684 83.0749 2.46188C122.663 -10.0495 160.532 30.7684 199.045 59.4152C246.814 94.9469 271.265 63.8666 254.777 107.765C238.247 151.769 199.005 160.906 187.571 152.426Z" 
          fill={color}
        />
      </g>
      <defs>
        <filter id="filter0_d_93_111" x="0" y="0" width="578" height="395" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix"/>
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
          <feOffset dy="16"/>
          <feGaussianBlur stdDeviation="2"/>
          <feComposite in2="hardAlpha" operator="out"/>
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_93_111"/>
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_93_111" result="shape"/>
        </filter>
      </defs>
    </svg>
  );
};

export default ClothCraftLogo;
