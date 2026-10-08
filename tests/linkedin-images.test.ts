import { describe, it, expect } from "vitest";
import { companyUrlFromUrn, linkedInImageUrl } from "@/lib/linkedin/images";
import { parseReactions } from "@/lib/linkedin/engagers";

/** Profile photos and company logos are captured from the payloads LinkedIn already sends. */

const vector = (root: string, sizes: number[]) => ({
  rootUrl: root,
  artifacts: sizes.map((w) => ({ width: w, fileIdentifyingUrlPathSegment: `${w}_${w}/photo.jpg?e=1&t=x` })),
});

describe("linkedInImageUrl", () => {
  it("picks the artifact closest to the wanted width from a Sales Nav vector image", () => {
    const img = vector("https://media.licdn.com/dms/image/v2/ABC/profile-displayphoto-shrink_", [100, 200, 400, 800]);
    expect(linkedInImageUrl(img)).toBe("https://media.licdn.com/dms/image/v2/ABC/profile-displayphoto-shrink_200_200/photo.jpg?e=1&t=x");
    expect(linkedInImageUrl(img, 100)).toContain("shrink_100_100");
  });

  it("finds the image inside Voyager wrappers (mini profile picture, lockup attributes)", () => {
    const mini = { "com.linkedin.common.VectorImage": vector("https://media.licdn.com/dms/image/X/", [100]) };
    expect(linkedInImageUrl(mini)).toBe("https://media.licdn.com/dms/image/X/100_100/photo.jpg?e=1&t=x");
    const lockupImage = { attributes: [{ detailData: { nonEntityProfilePicture: { vectorImage: vector("https://media.licdn.com/dms/image/Y/", [200]) } } }] };
    expect(linkedInImageUrl(lockupImage)).toContain("https://media.licdn.com/dms/image/Y/");
  });

  it("refuses anything that is not LinkedIn's CDN, and empty input", () => {
    expect(linkedInImageUrl(vector("https://evil.example/", [200]))).toBeNull();
    expect(linkedInImageUrl({ url: "javascript:alert(1)" })).toBeNull();
    expect(linkedInImageUrl(null)).toBeNull();
    expect(linkedInImageUrl({ rootUrl: "https://media.licdn.com/", artifacts: [] })).toBeNull();
  });
});

describe("companyUrlFromUrn", () => {
  it("turns Sales Nav and dash company URNs into the company page", () => {
    expect(companyUrlFromUrn("urn:li:fs_salesCompany:1441")).toBe("https://www.linkedin.com/company/1441");
    expect(companyUrlFromUrn("urn:li:fsd_company:99")).toBe("https://www.linkedin.com/company/99");
    expect(companyUrlFromUrn("urn:li:fs_salesCompany:(1441,abc)")).toBeNull();
    expect(companyUrlFromUrn(undefined)).toBeNull();
  });
});

describe("engagers carry the reactor's photo", () => {
  it("reads it from the reactor lockup", () => {
    const json = {
      elements: [{
        reactionType: "LIKE",
        actorUrn: "urn:li:fsd_profile:ACoAAB",
        reactorLockup: {
          title: { text: "Kat Bell" },
          subtitle: { text: "VP Education @ Ivybrook" },
          navigationUrl: "https://www.linkedin.com/in/katbell?mini=true",
          image: { attributes: [{ detailData: { nonEntityProfilePicture: { vectorImage: vector("https://media.licdn.com/dms/image/K/", [100, 200]) } } }] },
        },
      }],
    };
    const [e] = parseReactions(json);
    expect(e.name).toBe("Kat Bell");
    expect(e.imageUrl).toBe("https://media.licdn.com/dms/image/K/100_100/photo.jpg?e=1&t=x");
  });
});
