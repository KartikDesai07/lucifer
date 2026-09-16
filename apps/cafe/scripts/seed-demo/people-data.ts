/**
 * Demo customers, staff, and the word lists the order/extras planners draw
 * from (event/reservation templates, cancel/void reasons, order notes).
 * Pure data, no imports beyond ./types.
 *
 * Mobiles are 10 digits in the 9825xxxxxx / 9898xxxxxx / 9909xxxxxx ranges
 * (common Gujarat prefixes), all distinct across customers AND staff.
 */
import type { DemoCustomer, DemoStaffMember } from "./types";

export const DEMO_CUSTOMERS: DemoCustomer[] = [
  { name: "Priyanka Shah", mobile: "9825100000", notes: "VIP" },
  { name: "Rakesh Patel", mobile: "9898100037", notes: "Regular" },
  { name: "Ketan Trivedi", mobile: "9909100074", notes: "Regular" },
  { name: "Bhavna Mehta", mobile: "9825100111", notes: "VIP" },
  { name: "Nikunj Parikh", mobile: "9898100148", notes: "Regular" },
  { name: "Foram Desai", mobile: "9909100185", notes: "Regular" },
  { name: "Mihir Joshi", mobile: "9825100222", notes: "Regular" },
  { name: "Ekta Shah", mobile: "9898100259", notes: "Regular" },
  { name: "Vishal Gohil", mobile: "9909100296", notes: "Regular" },
  { name: "Payal Vaidya", mobile: "9825100333", notes: "VIP" },
  { name: "Chirag Solanki", mobile: "9898100370", notes: "Regular" },
  { name: "Ruchita Bhatt", mobile: "9909100407", notes: "Regular" },
  { name: "Jignesh Modi", mobile: "9825100444", notes: "Regular" },
  { name: "Sneha Panchal", mobile: "9898100481", notes: "Regular" },
  { name: "Harshad Rana", mobile: "9909100518", notes: "Regular" },
  { name: "Deepika Thakkar", mobile: "9825100555", notes: "Regular" },
  { name: "Ashish Chauhan", mobile: "9898100592", notes: "Regular" },
  { name: "Komal Dave", mobile: "9909100629", notes: "Regular" },
  { name: "Yash Pandya", mobile: "9825100666", notes: "VIP" },
  { name: "Meera Vyas", mobile: "9898100703", notes: "Regular" },
  { name: "Sagar Bhavsar", mobile: "9909100740", notes: "Regular" },
  { name: "Trupti Kapadia", mobile: "9825100777", notes: "Regular" },
  { name: "Dhruv Shukla", mobile: "9898100814", notes: "Regular" },
  { name: "Alpa Mistry", mobile: "9909100851", notes: "Regular" },
  { name: "Kunal Sheth", mobile: "9825100888", notes: "VIP" },
  { name: "Nidhi Raval", mobile: "9898100925", notes: "Regular" },
  { name: "Paresh Bhatia", mobile: "9909100962", notes: "Regular" },
  { name: "Riddhi Doshi", mobile: "9825100999", notes: "Regular" },
  { name: "Sameer Antani", mobile: "9898101036", notes: "Regular" },
  { name: "Urvi Contractor", mobile: "9909101073", notes: "Regular" },
  { name: "Bhargav Vora", mobile: "9825101110", notes: "Regular" },
  { name: "Krishna Iyer", mobile: "9898101147", notes: "Regular" },
  { name: "Falguni Amin", mobile: "9909101184", notes: "Regular" },
  { name: "Devang Oza", mobile: "9825101221", notes: "Regular" },
  { name: "Hetal Zaveri", mobile: "9898101258", notes: "VIP" },
  { name: "Manan Shroff", mobile: "9909101295", notes: "Regular" },
  { name: "Pooja Nair", mobile: "9825101332", notes: "Regular" },
  { name: "Tarun Kothari", mobile: "9898101369", notes: "Regular" },
  { name: "Anjali Soni", mobile: "9909101406", notes: "Regular" },
  { name: "Vipul Agrawal", mobile: "9825101443", notes: "Regular" },
];

export const DEMO_STAFF: DemoStaffMember[] = [
  { name: "Priya Shah", username: "priya", mobile: "9825199001", weight: 45 },
  { name: "Rahul Mehta", username: "rahul", mobile: "9898199002", weight: 30 },
  { name: "Amit Patel", username: "amit", mobile: "9909199003", weight: 15 },
];

/** Event booking templates: payable range (rupees) + a sample notes line. */
export const EVENT_TEMPLATES = [
  { eventName: "Birthday Party", payableMin: 4000, payableMax: 15000, notes: "Cake table + balloon decor requested" },
  { eventName: "Kitty Party", payableMin: 3000, payableMax: 9000, notes: "Ladies' group, prefers the rooftop table" },
  { eventName: "Office Team Treat", payableMin: 6000, payableMax: 20000, notes: "Team of 12-15, wants a private corner" },
  { eventName: "Anniversary Celebration", payableMin: 5000, payableMax: 18000, notes: "Candlelight setup for two families" },
  { eventName: "Farewell Party", payableMin: 4000, payableMax: 12000, notes: "College group, wants a group photo spot" },
  { eventName: "Baby Shower", payableMin: 5000, payableMax: 16000, notes: "Pastel theme, no loud music please" },
  { eventName: "Engagement Tea", payableMin: 6000, payableMax: 25000, notes: "Both families attending, needs extra seating" },
  { eventName: "College Reunion", payableMin: 3000, payableMax: 11000, notes: "Batch of 2015, evening slot preferred" },
];

export const RESERVATION_NOTES = [
  "Window seat if possible",
  "Celebrating a birthday, please keep a candle ready",
  "Wheelchair access needed",
  "Bringing two toddlers, a high chair would help",
  "Anniversary dinner, quiet corner preferred",
  "Group of friends, would like to sit together",
];

export const ORDER_NOTES = [
  "No onion no garlic",
  "Less spicy please",
  "Extra napkins",
  "Birthday — please add a candle",
  "Pack half the order to go",
  "First visit, staff recommended the bestsellers",
];

export const CANCEL_REASONS = [
  "Customer changed their mind",
  "Order placed by mistake",
  "Kitchen ran out of an ingredient",
  "Duplicate order raised at the counter",
];

export const VOID_REASONS = [
  "Wrong item rung up",
  "Customer sent it back",
  "Kitchen mistake — remade separately",
];

export const ITEM_INSTRUCTIONS = [
  "Less sugar",
  "No nuts please",
  "Extra hot",
  "Make it less spicy",
  "Serve without cream",
];

export const SELF_ORDER_NOTES = [
  "Please bring extra spoons",
  "One of us has a nut allergy",
  "In a bit of a hurry, thank you",
  "Celebrating a small occasion today",
];

export const DUE_NOTES = [
  "Partial payment collected at the table",
  "Paid on the next visit",
  "Balance cleared over phone confirmation",
];
