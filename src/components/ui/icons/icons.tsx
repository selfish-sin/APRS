/** 图标：20 × 20 的线条图标
 *  描边从导出 SVG 原样搬来，颜色换成 currentColor。默认 20px。
 */
import type { ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  /** 默认 20，和 Figma 图标框一致 */
  size?: number;
  /** 有意义时读出来；不传则 aria-hidden */
  title?: string;
};

function Glyph({ size = 20, title, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

function Stroke({ d, join = true }: { d: string; join?: boolean }) {
  return (
    <path
      d={d}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin={join ? "round" : undefined}
    />
  );
}

/** Icon/home · node 162:302 */
export function HomeIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M3.5 9L10 3.5L16.5 9V16C16.5 16.2652 16.3946 16.5196 16.2071 16.7071C16.0196 16.8946 15.7652 17 15.5 17H12V12H8V17H4.5C4.23478 17 3.98043 16.8946 3.79289 16.7071C3.60536 16.5196 3.5 16.2652 3.5 16V9Z" /></Glyph>;
}

/** Icon/calendar · node 162:308 */
export function CalendarIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M3 8.5H17M7 2.5V6.5M13 2.5V6.5M5 4.5H15C16.1046 4.5 17 5.39543 17 6.5V15C17 16.1046 16.1046 17 15 17H5C3.89543 17 3 16.1046 3 15V6.5C3 5.39543 3.89543 4.5 5 4.5Z" /></Glyph>;
}

/** Icon/pen · node 162:314 */
export function PenIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M12 5L15 8M4 16L5 12L13.3 3.69999C13.4304 3.56695 13.5859 3.46126 13.7577 3.3891C13.9294 3.31695 14.1137 3.27979 14.3 3.27979C14.4863 3.27979 14.6706 3.31695 14.8423 3.3891C15.0141 3.46126 15.1696 3.56695 15.3 3.69999L16.3 4.69999C16.433 4.83034 16.5387 4.98593 16.6109 5.15764C16.683 5.32935 16.7202 5.51373 16.7202 5.69999C16.7202 5.88624 16.683 6.07063 16.6109 6.24234C16.5387 6.41405 16.433 6.56964 16.3 6.69999L8 15L4 16Z" /></Glyph>;
}

/** Icon/show · node 162:321 */
export function ShowIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M6 14.5H14M5 3H15C16.1046 3 17 3.89543 17 5V15C17 16.1046 16.1046 17 15 17H5C3.89543 17 3 16.1046 3 15V5C3 3.89543 3.89543 3 5 3ZM7 6H13C13.5523 6 14 6.44772 14 7V10.5C14 11.0523 13.5523 11.5 13 11.5H7C6.44772 11.5 6 11.0523 6 10.5V7C6 6.44772 6.44772 6 7 6Z" /></Glyph>;
}

/** Icon/workflow · node 162:329 */
export function WorkflowIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M7 5C7 6.10457 6.10457 7 5 7C3.89543 7 3 6.10457 3 5C3 3.89543 3.89543 3 5 3C6.10457 3 7 3.89543 7 5ZM7 5H8.5C9.69347 5 10.8381 5.47411 11.682 6.31802C12.5259 7.16193 13 8.30653 13 9.5M7 15C7 16.1046 6.10457 17 5 17C3.89543 17 3 16.1046 3 15C3 13.8954 3.89543 13 5 13C6.10457 13 7 13.8954 7 15ZM7 15H8.5C9.69347 15 10.8381 14.5259 11.682 13.682C12.5259 12.8381 13 11.6935 13 10.5M17 10C17 11.1046 16.1046 12 15 12C13.8954 12 13 11.1046 13 10C13 8.89543 13.8954 8 15 8C16.1046 8 17 8.89543 17 10Z" /></Glyph>;
}

/** Icon/artwork · node 162:336 */
export function ArtworkIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M17 13L13 9L6 16M5 4H15C16.1046 4 17 4.89543 17 6V14C17 15.1046 16.1046 16 15 16H5C3.89543 16 3 15.1046 3 14V6C3 4.89543 3.89543 4 5 4ZM9 8.5C9 9.32843 8.32843 10 7.5 10C6.67157 10 6 9.32843 6 8.5C6 7.67157 6.67157 7 7.5 7C8.32843 7 9 7.67157 9 8.5Z" /></Glyph>;
}

/** Icon/people · node 162:343 */
export function PeopleIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M3 16.5C3.6 13.9 5.6 12.5 8 12.5C10.4 12.5 12.4 13.9 13 16.5M13 4.20001C13.663 4.20001 14.2989 4.4634 14.7678 4.93225C15.2366 5.40109 15.5 6.03697 15.5 6.70001C15.5 7.36305 15.2366 7.99894 14.7678 8.46778C14.2989 8.93662 13.663 9.20001 13 9.20001M14.5 12.6C15.8 13.1 16.7 14.4 17 16.5M11 7C11 8.65685 9.65685 10 8 10C6.34315 10 5 8.65685 5 7C5 5.34315 6.34315 4 8 4C9.65685 4 11 5.34315 11 7Z" /></Glyph>;
}

/** Icon/building · node 162:348 */
export function BuildingIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M4 17V6.5L10 3L16 6.5V17M4 17H2.5M4 17H8.5M16 17H11.5M16 17H17.5M8.5 17H11.5M8.5 17V13.5H11.5V17M7.5 8.5H8.5M11.5 8.5H12.5M7.5 11H8.5M11.5 11H12.5" /></Glyph>;
}

/** Icon/map · node 162:354 */
export function MapIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M12.5 5.5L7.5 3.5L3 5.5V16.5L7.5 14.5M7.5 3.5V14.5M7.5 14.5L12.5 16.5L17 14.5V3.5L12.5 5.5M12.5 5.5V16.5" /></Glyph>;
}

/** Icon/pin · node 162:360 */
export function PinIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <Stroke d="M10 17.5C10 17.5 15.5 12.7 15.5 8.5C15.5 7.04131 14.9205 5.64236 13.8891 4.61091C12.8576 3.57946 11.4587 3 10 3C8.54131 3 7.14236 3.57946 6.11091 4.61091C5.07946 5.64236 4.5 7.04131 4.5 8.5C4.5 12.7 10 17.5 10 17.5Z" />
      <Stroke d="M10 10.5C11.1046 10.5 12 9.60457 12 8.5C12 7.39543 11.1046 6.5 10 6.5C8.89543 6.5 8 7.39543 8 8.5C8 9.60457 8.89543 10.5 10 10.5Z" />
    </Glyph>
  );
}

/** Icon/cube · node 162:366 */
export function CubeIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M3.5 6.39999V13.6L10 17.2L16.5 13.6V6.39999L10 2.79999L3.5 6.39999ZM16.5 6.39999L10 9.99999M10 17.2V9.99999M3.5 6.39999L10 9.99999" /></Glyph>;
}

/** Icon/contract · node 162:372 */
export function ContractIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M15.5 6L12 2.5H5V17.5H15.5V6ZM12 2.5V6H15.5M7.5 9.5H12.5M7.5 12H10.5M7.5 15C8.5 14.2 9.1 14.2 9.7 15C10.3 15.8 10.9 15.8 12 14.8" /></Glyph>;
}

/** Icon/search · node 162:378 */
export function SearchIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M13 13L17 17M14.2 8.99999C14.2 11.8719 11.8719 14.2 9.00005 14.2C6.12817 14.2 3.80005 11.8719 3.80005 8.99999C3.80005 6.12811 6.12817 3.79999 9.00005 3.79999C11.8719 3.79999 14.2 6.12811 14.2 8.99999Z" /></Glyph>;
}

/** Icon/plus · node 162:383 */
export function PlusIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M10 4.5V10M10 10V15.5M10 10H4.5M10 10H15.5" /></Glyph>;
}

/** Icon/chevron · node 162:388 */
export function ChevronIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M6 8L10 12L14 8" /></Glyph>;
}

/** Icon/check · node 162:393 */
export function CheckIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M4.5 10.5L8 14L15.5 6" /></Glyph>;
}

/** Icon/clock · node 162:399 */
export function ClockIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M10 6.20001V10L12.6 11.8M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z" /></Glyph>;
}

/** Icon/link · node 162:404 */
export function LinkIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M8.50008 11.5L11.5001 8.50001M9.20008 6.30001L10.3001 5.20001C10.5824 4.91767 10.9176 4.6937 11.2865 4.5409C11.6554 4.38809 12.0508 4.30945 12.4501 4.30945C12.8494 4.30945 13.2448 4.38809 13.6137 4.5409C13.9825 4.6937 14.3177 4.91767 14.6001 5.20001C14.8824 5.48235 15.1064 5.81754 15.2592 6.18644C15.412 6.55533 15.4906 6.95072 15.4906 7.35001C15.4906 7.7493 15.412 8.14468 15.2592 8.51358C15.1064 8.88248 14.8824 9.21767 14.6001 9.50001L13.5001 10.6M10.8001 13.7L9.70008 14.8C9.12986 15.3702 8.35649 15.6906 7.55008 15.6906C6.74367 15.6906 5.9703 15.3702 5.40008 14.8C4.82987 14.2298 4.50952 13.4564 4.50952 12.65C4.50952 11.8436 4.82987 11.0702 5.40008 10.5L6.50008 9.40001" /></Glyph>;
}

/** Icon/arrow · node 162:409 */
export function ArrowIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M6 14L14 6M14 12.5V6H7.5" /></Glyph>;
}

/** Icon/globe · node 162:415 */
export function GlobeIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M17 10C17 13.866 13.866 17 10 17M17 10C17 6.13401 13.866 3 10 3M17 10H12.8M10 17C6.13401 17 3 13.866 3 10M10 17C11.9 15 12.8 12.6 12.8 10M10 17C8.1 15 7.2 12.6 7.2 10M3 10C3 6.13401 6.13401 3 10 3M3 10H7.2M10 3C11.9 5 12.8 7.4 12.8 10M10 3C8.1 5 7.2 7.4 7.2 10M7.2 10H12.8" /></Glyph>;
}

/** Icon/page · node 162:421 */
export function PageIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M15 6L11.5 2.5H5.5V17.5H15V6ZM11.5 2.5V6H15" /></Glyph>;
}

/** Icon/more · node 162:428 */
export function MoreIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5.0001 10.9C5.49715 10.9 5.9001 10.4971 5.9001 10C5.9001 9.50295 5.49715 9.10001 5.0001 9.10001C4.50304 9.10001 4.1001 9.50295 4.1001 10C4.1001 10.4971 4.50304 10.9 5.0001 10.9Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.0001 10.9C10.4972 10.9 10.9001 10.4971 10.9001 10C10.9001 9.50295 10.4972 9.10001 10.0001 9.10001C9.50304 9.10001 9.1001 9.50295 9.1001 10C9.1001 10.4971 9.50304 10.9 10.0001 10.9Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.0001 10.9C15.4972 10.9 15.9001 10.4971 15.9001 10C15.9001 9.50295 15.4972 9.10001 15.0001 9.10001C14.503 9.10001 14.1001 9.50295 14.1001 10C14.1001 10.4971 14.503 10.9 15.0001 10.9Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Glyph>
  );
}

/** Icon/eye · node 162:434 */
export function EyeIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <Stroke d="M2.5 10C2.5 10 5.2 5 10 5C14.8 5 17.5 10 17.5 10C17.5 10 14.8 15 10 15C5.2 15 2.5 10 2.5 10Z" />
      <Stroke d="M10 12.2C11.2151 12.2 12.2 11.215 12.2 9.99999C12.2 8.78496 11.2151 7.79999 10 7.79999C8.78502 7.79999 7.80005 8.78496 7.80005 9.99999C7.80005 11.215 8.78502 12.2 10 12.2Z" />
    </Glyph>
  );
}

/** Icon/alert · node 162:440 */
export function AlertIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M10 8V11.5M10 14H10.01M10 3L17.5 16H2.5L10 3Z" /></Glyph>;
}

/** Icon/x · node 182:2310 */
export function XIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M5.5 5.5L10 10M10 10L14.5 14.5M10 10L14.5 5.5M10 10L5.5 14.5" join={false} /></Glyph>;
}

/** Icon/menu · node 313:7243 */
export function MenuIcon(props: IconProps) {
  return <Glyph {...props}><Stroke d="M4 6H16M4 10H16M4 14H16" /></Glyph>;
}

export const ICONS = [

  { name: "Icon/home", node: "162:302", Icon: HomeIcon },
  { name: "Icon/calendar", node: "162:308", Icon: CalendarIcon },
  { name: "Icon/pen", node: "162:314", Icon: PenIcon },
  { name: "Icon/show", node: "162:321", Icon: ShowIcon },
  { name: "Icon/workflow", node: "162:329", Icon: WorkflowIcon },
  { name: "Icon/artwork", node: "162:336", Icon: ArtworkIcon },
  { name: "Icon/people", node: "162:343", Icon: PeopleIcon },
  { name: "Icon/building", node: "162:348", Icon: BuildingIcon },
  { name: "Icon/map", node: "162:354", Icon: MapIcon },
  { name: "Icon/pin", node: "162:360", Icon: PinIcon },
  { name: "Icon/cube", node: "162:366", Icon: CubeIcon },
  { name: "Icon/contract", node: "162:372", Icon: ContractIcon },
  { name: "Icon/search", node: "162:378", Icon: SearchIcon },
  { name: "Icon/plus", node: "162:383", Icon: PlusIcon },
  { name: "Icon/chevron", node: "162:388", Icon: ChevronIcon },
  { name: "Icon/check", node: "162:393", Icon: CheckIcon },
  { name: "Icon/clock", node: "162:399", Icon: ClockIcon },
  { name: "Icon/link", node: "162:404", Icon: LinkIcon },
  { name: "Icon/arrow", node: "162:409", Icon: ArrowIcon },
  { name: "Icon/globe", node: "162:415", Icon: GlobeIcon },
  { name: "Icon/page", node: "162:421", Icon: PageIcon },
  { name: "Icon/more", node: "162:428", Icon: MoreIcon },
  { name: "Icon/eye", node: "162:434", Icon: EyeIcon },
  { name: "Icon/alert", node: "162:440", Icon: AlertIcon },
  { name: "Icon/x", node: "182:2310", Icon: XIcon },
  { name: "Icon/menu", node: "313:7243", Icon: MenuIcon },
] as const;
