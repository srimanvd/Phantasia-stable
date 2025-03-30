import phantasia from "./assets/icons/phantasia.png";

export default function Logo() {
  return (
    <div className="flex h-24 py-2 items-center"> {/* Added pl-2 for left padding */}
        <img
        src={phantasia}
        alt={"logo"}
        className="h-70 w-auto object-contain"
        />
    </div>
  );
}