import type { ViewerProps } from '../registry';

export default function ImageView({ content, title }: ViewerProps) {
  return (
    <div className="flex items-center justify-center">
      <img
        src={content}
        alt={title}
        className="max-w-full h-auto rounded-lg"
        onError={(e) => {
          const img = e.currentTarget;
          console.error('Image failed to load. src length:', img.src.length);
        }}
      />
    </div>
  );
}
