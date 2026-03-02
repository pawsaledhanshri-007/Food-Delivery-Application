require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('Frontend'));
app.use('/uploads', express.static('uploads'));

/* ================= DATABASE ================= */

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect(err=>{
    if(err) throw err;
    console.log("MySQL Connected");
});

/* ================= FILE UPLOAD ================= */

const storage = multer.diskStorage({
    destination: (req,file,cb)=> cb(null,'uploads/'),
    filename: (req,file,cb)=> cb(null,Date.now()+path.extname(file.originalname))
});
const upload = multer({storage});

/* ================= AUTH ================= */

app.post('/signup', async(req,res)=>{
    const {username,email,password,role} = req.body;

    if(!username || !email || !password || !role){
        return res.json({message:"All fields required"});
    }

    const hash = await bcrypt.hash(password,10);

    db.query(
        "INSERT INTO users (username,email,password,role) VALUES (?,?,?,?)",
        [username,email,hash,role],
        (err,result)=>{
            if(err){
                if(err.code === 'ER_DUP_ENTRY')
                    return res.json({message:"Email already exists"});
                return res.status(500).json(err);
            }

            // Send newly created user object
            res.json({
                id: result.insertId,
                username,
                email,
                role
            });
        }
    );
});

app.post('/login',(req,res)=>{
    const {email,password} = req.body;

    db.query("SELECT * FROM users WHERE email=?",[email], async(err,result)=>{
        if(result.length===0)
            return res.json({message:"User not found"});

        const user = result[0];
        const valid = await bcrypt.compare(password,user.password);

        if(!valid)
            return res.json({message:"Wrong Password"});

        // Remove password before sending
        delete user.password;

        res.json(user);
    });
});

/* ================= GET RESTAURANTS ================= */

app.get('/restaurants',(req,res)=>{
    db.query("SELECT id,username,email FROM users WHERE role='restaurant'",
        (err,result)=> res.json(result)
    );
});

/* ================= FOOD ================= */

app.post('/add-food', upload.single('image'), (req,res)=>{
    const {restaurant_id,name,price,gst} = req.body;

    if(!req.file)
        return res.json({message:"Image required"});

    const image = req.file.filename;

    db.query(
        "INSERT INTO food_items (restaurant_id,name,price,gst,image) VALUES (?,?,?,?,?)",
        [restaurant_id,name,price,gst,image],
        (err)=>{
            if(err) return res.status(500).json(err);
            res.json({message:"Food Added"});
        }
    );
});

app.get('/food/:restaurant_id',(req,res)=>{
    db.query(
        "SELECT * FROM food_items WHERE restaurant_id=?",
        [req.params.restaurant_id],
        (err,result)=> res.json(result)
    );
});

app.delete('/delete-food/:id',(req,res)=>{
    db.query("DELETE FROM food_items WHERE id=?",
        [req.params.id],
        ()=> res.json({message:"Deleted"})
    );
});

/* ================= PLACE ORDER (CONSUMER) ================= */

app.post('/place-order',(req,res)=>{
    const {consumer_id,restaurant_id,total} = req.body;

    db.query(
        "INSERT INTO orders (user_id,restaurant_id,total,status) VALUES (?,?,?,'pending')",
        [consumer_id,restaurant_id,total],
        ()=> res.json({message:"Order Placed"})
    );
});

/* ================= RESTAURANT ACCEPT ORDER ================= */

app.post('/accept-order/:id',(req,res)=>{
    const orderId = req.params.id;

    // First update status to accepted
    db.query(
        "UPDATE orders SET status='accepted' WHERE id=?",
        [orderId],
        ()=>{

            // Auto assign driver
            db.query(
                "SELECT id FROM users WHERE role='driver' LIMIT 1",
                (err,drivers)=>{

                    if(drivers.length===0)
                        return res.json({message:"No Drivers Available"});

                    const driverId = drivers[0].id;

                    db.query(
                        "UPDATE orders SET driver_id=?, status='assigned' WHERE id=?",
                        [driverId,orderId],
                        ()=> res.json({message:"Driver Assigned"})
                    );
                }
            );
        }
    );
});

/* ================= MARK DELIVERED (DRIVER) ================= */

app.post('/deliver-order/:id',(req,res)=>{
    db.query(
        "UPDATE orders SET status='delivered' WHERE id=?",
        [req.params.id],
        ()=> res.json({message:"Order Delivered"})
    );
});

/* ================= GET ORDERS ================= */

app.get('/orders/:role/:id',(req,res)=>{
    const {role,id} = req.params;

    let sql="";

    if(role==="restaurant")
        sql="SELECT * FROM orders WHERE restaurant_id=?";

    if(role==="driver")
        sql="SELECT * FROM orders WHERE driver_id=?";

    if(role==="consumer")
        sql="SELECT * FROM orders WHERE user_id=?";

    db.query(sql,[id],(err,result)=>{
        if(err) return res.status(500).json(err);
        res.json(result);
    });
});

/* ================= START SERVER ================= */

app.listen(3000,()=> console.log("Server running on port 3000"));