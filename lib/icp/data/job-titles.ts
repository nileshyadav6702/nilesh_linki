/** Roles shown as quick-pick chips before the user types. */
export const POPULAR_ROLES = [
  "CEO", "COO", "CFO", "CTO", "CMO", "CSO", "CRO", "Co-Founder", "Founder", "Owner", "President",
  "VP Sales", "VP Marketing", "VP Engineering", "VP Operations", "Head of Sales", "Head of Marketing", "Head of Growth",
  "Sales Manager", "Marketing Manager", "Operations Manager", "HR Manager", "Product Manager",
];

/** Common B2B job titles searched as the user types. Free text is always allowed too. */
export const JOB_TITLES = [
  ...POPULAR_ROLES,
  "Chief Executive Officer", "Chief Operating Officer", "Chief Financial Officer", "Chief Technology Officer", "Chief Marketing Officer",
  "Chief Revenue Officer", "Chief Sales Officer", "Chief Product Officer", "Chief Information Officer", "Chief Information Security Officer",
  "Chief Data Officer", "Chief People Officer", "Chief Human Resources Officer", "Chief Customer Officer", "Chief Growth Officer",
  "Chief Strategy Officer", "Chief Digital Officer", "Chief of Staff", "Managing Director", "General Manager", "Partner", "Managing Partner",
  "Board Member", "Advisor", "Vice President", "Senior Vice President", "Executive Vice President",
  "VP of Sales", "VP of Marketing", "VP of Engineering", "VP of Product", "VP of Operations", "VP of Finance", "VP of People", "VP of Customer Success",
  "VP of Business Development", "VP of Revenue Operations", "VP of Partnerships", "VP of Growth", "VP of IT", "VP of Data",
  "Head of Product", "Head of Engineering", "Head of Operations", "Head of Finance", "Head of People", "Head of HR", "Head of Talent",
  "Head of Customer Success", "Head of Business Development", "Head of Partnerships", "Head of Revenue Operations", "Head of Demand Generation",
  "Head of Content", "Head of Brand", "Head of Design", "Head of Data", "Head of IT", "Head of Security", "Head of Procurement", "Head of Legal",
  "Director of Sales", "Director of Marketing", "Director of Engineering", "Director of Product", "Director of Operations", "Director of Finance",
  "Director of IT", "Director of HR", "Director of Customer Success", "Director of Business Development", "Director of Demand Generation",
  "Director of Revenue Operations", "Director of Partnerships", "Director of Procurement", "Director of Talent Acquisition",
  "Sales Director", "Marketing Director", "Commercial Director", "Regional Sales Manager", "Account Executive", "Enterprise Account Executive",
  "Account Manager", "Key Account Manager", "Sales Development Representative", "Business Development Representative", "Business Development Manager",
  "Sales Operations Manager", "Revenue Operations Manager", "Sales Enablement Manager", "Customer Success Manager", "Partnerships Manager",
  "Growth Manager", "Growth Marketer", "Demand Generation Manager", "Product Marketing Manager", "Content Marketing Manager", "Digital Marketing Manager",
  "Performance Marketing Manager", "Brand Manager", "Social Media Manager", "SEO Manager", "Marketing Operations Manager", "Community Manager",
  "Engineering Manager", "Software Engineer", "Senior Software Engineer", "Staff Engineer", "Principal Engineer", "DevOps Engineer",
  "Data Scientist", "Data Engineer", "Data Analyst", "Machine Learning Engineer", "Solutions Architect", "IT Manager", "IT Director",
  "Security Engineer", "Product Owner", "Senior Product Manager", "Group Product Manager", "UX Designer", "Product Designer",
  "Finance Manager", "Financial Controller", "Controller", "Accountant", "Procurement Manager", "Purchasing Manager", "Supply Chain Manager",
  "Logistics Manager", "Office Manager", "Project Manager", "Program Manager", "Recruiter", "Talent Acquisition Manager", "People Operations Manager",
  "HR Business Partner", "Learning and Development Manager", "Legal Counsel", "General Counsel", "Compliance Manager", "Customer Support Manager",
  "Founder & CEO", "Entrepreneur", "Consultant", "Principal",
].filter((t, i, all) => all.indexOf(t) === i);
