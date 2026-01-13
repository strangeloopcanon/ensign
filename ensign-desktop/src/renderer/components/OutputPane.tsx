import React, { useEffect, useRef } from 'react';

export function OutputPane(props: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [props.text]);
  return (
    <div className="output" ref={ref}>{props.text}</div>
  );
}
