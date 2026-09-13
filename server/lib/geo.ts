/** Realistic Indian administrative vocabulary used by the seed generators. */

export interface DistrictRef {
  district: string;
  state: string;
}

export const DISTRICTS: DistrictRef[] = [
  { district: 'Pune', state: 'Maharashtra' },
  { district: 'Nagpur', state: 'Maharashtra' },
  { district: 'Nashik', state: 'Maharashtra' },
  { district: 'Aurangabad', state: 'Maharashtra' },
  { district: 'Jaipur', state: 'Rajasthan' },
  { district: 'Jodhpur', state: 'Rajasthan' },
  { district: 'Udaipur', state: 'Rajasthan' },
  { district: 'Lucknow', state: 'Uttar Pradesh' },
  { district: 'Varanasi', state: 'Uttar Pradesh' },
  { district: 'Gorakhpur', state: 'Uttar Pradesh' },
  { district: 'Kanpur Nagar', state: 'Uttar Pradesh' },
  { district: 'Patna', state: 'Bihar' },
  { district: 'Gaya', state: 'Bihar' },
  { district: 'Muzaffarpur', state: 'Bihar' },
  { district: 'Indore', state: 'Madhya Pradesh' },
  { district: 'Bhopal', state: 'Madhya Pradesh' },
  { district: 'Gwalior', state: 'Madhya Pradesh' },
  { district: 'Coimbatore', state: 'Tamil Nadu' },
  { district: 'Madurai', state: 'Tamil Nadu' },
  { district: 'Tiruchirappalli', state: 'Tamil Nadu' },
  { district: 'Bengaluru Urban', state: 'Karnataka' },
  { district: 'Mysuru', state: 'Karnataka' },
  { district: 'Belagavi', state: 'Karnataka' },
  { district: 'Ahmedabad', state: 'Gujarat' },
  { district: 'Surat', state: 'Gujarat' },
  { district: 'Rajkot', state: 'Gujarat' },
  { district: 'Cuttack', state: 'Odisha' },
  { district: 'Ganjam', state: 'Odisha' },
  { district: 'Ranchi', state: 'Jharkhand' },
  { district: 'Dhanbad', state: 'Jharkhand' },
  { district: 'Guwahati', state: 'Assam' },
  { district: 'Dibrugarh', state: 'Assam' },
  { district: 'Ludhiana', state: 'Punjab' },
  { district: 'Amritsar', state: 'Punjab' },
  { district: 'Ernakulam', state: 'Kerala' },
  { district: 'Thiruvananthapuram', state: 'Kerala' },
  { district: 'Visakhapatnam', state: 'Andhra Pradesh' },
  { district: 'Guntur', state: 'Andhra Pradesh' },
  { district: 'Raipur', state: 'Chhattisgarh' },
  { district: 'Dehradun', state: 'Uttarakhand' },
];

export const CITIES: string[] = [
  'Delhi',
  'Mumbai',
  'Kolkata',
  'Chennai',
  'Bengaluru',
  'Hyderabad',
  'Ahmedabad',
  'Pune',
  'Jaipur',
  'Lucknow',
  'Kanpur',
  'Patna',
  'Bhopal',
  'Indore',
  'Nagpur',
  'Surat',
  'Ludhiana',
  'Varanasi',
  'Guwahati',
  'Kochi',
];

export const DEPARTMENTS: string[] = [
  'Health & Family Welfare',
  'Jal Shakti',
  'Road Transport & Highways',
  'Urban Affairs',
  'Rural Development',
  'Education',
  'Environment & Climate',
  'Women & Child Development',
];

export const SCHEMES: { scheme: string; department: string }[] = [
  { scheme: 'Ayushman Bharat PM-JAY', department: 'Health & Family Welfare' },
  { scheme: 'National Health Mission', department: 'Health & Family Welfare' },
  { scheme: 'Jal Jeevan Mission', department: 'Jal Shakti' },
  { scheme: 'AMRUT 2.0', department: 'Urban Affairs' },
  { scheme: 'Swachh Bharat Mission Urban', department: 'Urban Affairs' },
  { scheme: 'PMGSY Rural Roads', department: 'Rural Development' },
  { scheme: 'Bharatmala Pariyojana', department: 'Road Transport & Highways' },
  { scheme: 'Samagra Shiksha', department: 'Education' },
  { scheme: 'PM POSHAN', department: 'Education' },
  { scheme: 'National Clean Air Programme', department: 'Environment & Climate' },
  { scheme: 'Mission Shakti', department: 'Women & Child Development' },
  { scheme: 'MGNREGS', department: 'Rural Development' },
];

export const NH_NUMBERS: string[] = [
  'NH-44', 'NH-48', 'NH-27', 'NH-19', 'NH-16', 'NH-30', 'NH-52', 'NH-66', 'NH-6', 'NH-33',
];

export const GRIEVANCE_CATEGORIES: string[] = [
  'Water supply interruption',
  'Hospital bed unavailability',
  'Ambulance delay',
  'Road damage / pothole',
  'Street light outage',
  'Sanitation / garbage',
  'Scheme payment pending',
  'Air pollution complaint',
];

export const FIRST_NAMES: string[] = [
  'Aarav', 'Vivaan', 'Ananya', 'Diya', 'Ishaan', 'Kabir', 'Meera', 'Rohan', 'Sanya', 'Aditya',
  'Priya', 'Rahul', 'Neha', 'Sunita', 'Ramesh', 'Lakshmi', 'Farhan', 'Zoya', 'Arjun', 'Kavya',
];

export const LAST_NAMES: string[] = [
  'Sharma', 'Verma', 'Patel', 'Reddy', 'Iyer', 'Nair', 'Das', 'Singh', 'Gupta', 'Kulkarni',
  'Chauhan', 'Mishra', 'Banerjee', 'Khan', 'Pillai', 'Yadav', 'Joshi', 'Rao', 'Sinha', 'Mahato',
];
