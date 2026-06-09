"use client";

/**
 * ASCII world map — generated offline from world GeoJSON
 * (johan/world.geo.json, Natural Earth data) rasterized with a
 * point-in-polygon pass at 150×41 chars (3×3 supersampled per
 * cell, so coastal cells containing any land render a dot). Extent: lon −169…191,
 * lat 74…−56. Markers project through the same extent, so the
 * percentages land on real cities:
 *   x% = (lon + 169) / 360 · 100,  y% = (74 − lat) / 130 · 100
 *
 * Sizing: the mono font scales with the viewport (clamped), so the
 * map fills the section on large screens instead of capping at a
 * fixed pixel width.
 */

const MAP = `                  ········· ·············      ···············                              ···   ····································           ··   
 ··························· ··············    ·············                 ·········· ·· ························································   
 ···································· ·······   ·········   ·····          ···········································································
 ································ ··········    ······       ···        ·········································································     
 ·······························     ·······       ··                   ······ ·······························································        
  ·····       ·····················   ········                      ··   ························································      ····           
 ·             ·································                  ····· ··························································     ···            
                 ·······························                    ·······························································    ·              
                  ·······························                   ······························································                    
                  ···························                     ················· · ·············································                   
                  ························                        ······  ················· ·································   ··                    
                   ····················                           ············ ·········································· ···  ···                    
                    ···················                            ········     ·   ·····································  ······                     
                     ················                             ························································  ··                        
                      ·········     ·                           ··························································                            
                       ·······      ··                         ···························································                            
                          ····  ·· ·····                       ·································   ···················· ·                             
     ·                    ········     ····                    ································     ······   ········   ··                            
                             ·······                           ······························        ····    ·······    ··                            
                                 ···   ···                     ·····························         ···       ·····    ···                           
                                  ············                  ····························          ···      ·· ·    · ··                           
                                      ···········                ··························            ··     ····    ··  ·                           
                                     ·············                        ················                    ····  ····                              
                                    ················                      ···············                      ··· ········· ··                       
                                    ···················                   ··············                        ··· ··· ·· ········  ·                
                                    ····················                   ············                           ·····       · ······  ·             
                                     ···················                   ·············                               ·· ·      ····    ·            
                                      ·················                    ·············  ··                               ····· ··                   
                                       ················                    ·················                             ···········        ·         
                                         ·············                     ···········  ···                            ··············      ·          
                                         ·············                      ··········  ···                          ·················     ·          
                                         ··········                         ·········   ··                           ··················               
                                        ··········                           ·······                                  ·················               
                                        ··········                            ·····                                   ·················               
                                        ········                              ··                                      ···     ········        ··      
                                       ········                                                                                 ·····          ··     
                                       ······                                                                                      ··        ···      
                                       ·····                                                                                               ····       
                                       ····                                                        ·                                                  
                                       ···                                                                                                            
                                       ····                                                                                                           `;

type Marker = {
  city: string;
  x: number;
  y: number;
  /** which side the label chip hangs on; undefined = dot only */
  label?: "left" | "right" | "top" | "bottom";
};

const MARKERS: Marker[] = [
  { city: "Lagos", x: 47.9, y: 52.0, label: "left" },
  { city: "Ibadan", x: 48.0, y: 51.2 },
  { city: "Abuja", x: 49.0, y: 49.9, label: "top" },
  { city: "Kano", x: 49.3, y: 47.7 },
  { city: "Port Harcourt", x: 48.9, y: 53.2, label: "bottom" },
  { city: "Accra", x: 46.9, y: 52.6 },
  { city: "Nairobi", x: 57.2, y: 57.9, label: "right" },
];

const CHIP =
  "hidden sm:inline-block whitespace-nowrap rounded-full border border-white/10 bg-[#0a0a0c]/85 px-2.5 py-1 text-[11px] text-neutral-200 backdrop-blur-sm";

const LABEL_POS: Record<NonNullable<Marker["label"]>, string> = {
  left: "right-4 top-1/2 -translate-y-1/2",
  right: "left-4 top-1/2 -translate-y-1/2",
  top: "bottom-3.5 left-1/2 -translate-x-1/2",
  bottom: "top-3.5 left-1/2 -translate-x-1/2",
};

export function AsciiMap({ className }: { className?: string }) {
  return (
    <div className={`relative w-fit ${className ?? ""}`}>
      {/* soft glow under the active West-Africa cluster */}
      <div
        aria-hidden
        className="absolute left-[48%] top-[51%] size-[28%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/15 blur-3xl"
      />
      <pre
        aria-hidden
        className="select-none font-mono leading-[0.8] text-[#565b66]"
        style={{ fontSize: "clamp(3.8px, 0.85vw, 16px)" }}
      >
        {MAP}
      </pre>
      {MARKERS.map((m, i) => (
        <span
          key={m.city}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${m.x}%`, top: `${m.y}%` }}
        >
          <span
            className="absolute -inset-0.5 animate-ping rounded-full bg-blue-500/40"
            style={{ animationDelay: `${i * 0.45}s`, animationDuration: "2.4s" }}
          />
          <span className="block size-1 rounded-full bg-blue-400 shadow-[0_0_4px_1px_rgba(59,130,246,0.5)]" />
          {m.label && (
            <span className={`absolute ${LABEL_POS[m.label]} ${CHIP}`}>
              {m.city}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
