#!/usr/bin/env python3

import time
import math
import colorsys
import board
import digitalio
import psutil
import requests
import redis
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import adafruit_rgb_display.ili9341 as ili9341

# Configuration for CS and DC pins
cs_pin = digitalio.DigitalInOut(board.CE0)
dc_pin = digitalio.DigitalInOut(board.D25)
reset_pin = digitalio.DigitalInOut(board.D24)

# Config for display baudrate (default max is 24mhz)
BAUDRATE = 24000000

# Setup SPI bus using hardware SPI
spi = board.SPI()

# Create the display
disp = ili9341.ILI9341(
    spi,
    rotation=90,
    cs=cs_pin,
    dc=dc_pin,
    rst=reset_pin,
    baudrate=BAUDRATE,
)

# Create blank image for drawing
width = disp.width
height = disp.height
image = Image.new("RGB", (width, height))
draw = ImageDraw.Draw(image)

# Load fonts with different sizes for variety
try:
    font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
    font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
    font_mono = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 16)
except OSError:
    font_title = ImageFont.load_default()
    font = ImageFont.load_default()
    font_small = ImageFont.load_default()
    font_mono = ImageFont.load_default()

# Cyberpunk color palette
NEON_PINK = (255, 16, 240)
NEON_BLUE = (0, 240, 255)
NEON_PURPLE = (128, 0, 255)
CYBER_YELLOW = (255, 255, 0)
CYBER_GREEN = (0, 255, 160)
CYBER_RED = (255, 0, 80)
DARK_BG = (8, 8, 16)
DARKER_BG = (4, 4, 8)

# Animation variables
animation_frame = 0
loading_angle = 0
wave_offset = 0

def get_rainbow_color(offset):
    """Generate shifting rainbow colors"""
    hue = (offset % 360) / 360.0
    rgb = colorsys.hsv_to_rgb(hue, 1.0, 1.0)
    return tuple(int(x * 255) for x in rgb)

def draw_glowing_line(x1, y1, x2, y2, color, width=1):
    """Draw a line with a glow effect"""
    # Draw the main line
    draw.line((x1, y1, x2, y2), fill=color, width=width)
    
    # Draw the glow
    glow_color = tuple(max(0, min(255, c // 3)) for c in color)
    for i in range(1, 3):
        draw.line((x1, y1+i, x2, y2+i), fill=glow_color, width=width)
        draw.line((x1, y1-i, x2, y2-i), fill=glow_color, width=width)

def draw_cyber_box(x, y, width, height, color, title=""):
    """Draw a cyberpunk-style box with animated corners"""
    global animation_frame
    
    # Calculate corner animation
    corner_len = 10
    corner_pulse = abs(math.sin(animation_frame * 0.1)) * 0.5 + 0.5
    corner_color = tuple(int(c * corner_pulse) for c in color)
    
    # Draw corners
    for cx, cy in [(x, y), (x+width, y), (x, y+height), (x+width, y+height)]:
        draw.line((cx-corner_len, cy, cx+corner_len, cy), fill=corner_color, width=1)
        draw.line((cx, cy-corner_len, cx, cy+corner_len), fill=corner_color, width=1)
    
    # Draw title if provided
    if title:
        text_width = font_small.getlength(title)
        draw.rectangle((x+5, y-10, x+text_width+15, y+2), fill=DARKER_BG)
        draw.text((x+10, y-8), title, font=font_small, fill=color)

def draw_loading_circle(x, y, size, progress, color):
    """Draw an advanced loading circle with glow effect"""
    global loading_angle
    loading_angle = (loading_angle + 6) % 360
    start_angle = loading_angle
    end_angle = start_angle + (360 * progress)
    
    # Draw outer glow
    glow_color = tuple(max(0, min(255, c // 4)) for c in color)
    for i in range(2):
        draw.arc((x-size-i, y-size-i, x+size+i, y+size+i), 
                start_angle, end_angle, fill=glow_color, width=4)
    
    # Draw main arc
    draw.arc((x-size, y-size, x+size, y+size), 
            start_angle, end_angle, fill=color, width=3)

def draw_progress_bar(x, y, width, height, progress, color):
    """Draw a cyberpunk-style progress bar"""
    # Background with scanline effect
    for i in range(height):
        if i % 2 == 0:
            draw.line((x, y+i, x+width, y+i), 
                     fill=(color[0]//8, color[1]//8, color[2]//8))
    
    # Progress with gradient and glow
    if progress > 0:
        bar_width = int(width * progress)
        for i in range(bar_width):
            gradient_factor = (math.sin(i/width * math.pi) * 0.3 + 0.7)
            bar_color = tuple(int(c * gradient_factor) for c in color)
            draw.line((x+i, y, x+i, y+height), fill=bar_color)

def draw_status_box(x, y, title, status, color):
    """Draw a cyberpunk-style status box"""
    box_width = 140
    box_height = 50
    
    # Draw background with scanlines
    for i in range(box_height):
        if i % 2 == 0:
            draw.line((x, y+i, x+box_width, y+i), fill=DARKER_BG)
    
    # Draw cyber box
    draw_cyber_box(x, y, box_width, box_height, color, title)
    
    # Draw status with pulsing effect
    pulse = abs(math.sin(animation_frame * 0.1)) * 0.3 + 0.7
    status_color = tuple(int(c * pulse) for c in (CYBER_GREEN if status else CYBER_RED))
    
    icon = "⬤" if status else "⭘"
    status_text = "ONLINE" if status else "OFFLINE"
    draw.text((x+10, y+28), icon, font=font, fill=status_color)
    draw.text((x+35, y+28), status_text, font=font_small, fill=status_color)

def get_api_status():
    try:
        response = requests.get('http://localhost:3000/api/products', timeout=5)
        return response.status_code == 200
    except:
        return False

def get_redis_status():
    try:
        r = redis.Redis(host='localhost', port=6379, db=0)
        return r.ping()
    except:
        return False

def get_system_info():
    cpu = psutil.cpu_percent()
    memory = psutil.virtual_memory().percent
    disk = psutil.disk_usage('/').percent
    return cpu, memory, disk

def update_display():
    global animation_frame, wave_offset
    animation_frame = (animation_frame + 1) % 60
    wave_offset = (wave_offset + 2) % width

    # Draw cyberpunk background with wave effect
    for y in range(height):
        wave = math.sin((y + wave_offset) * 0.05) * 5
        color_shift = abs(math.sin(y * 0.01 + animation_frame * 0.1))
        color = (
            int(8 + wave + color_shift * 4),
            int(8 + wave),
            int(16 + wave + color_shift * 8)
        )
        draw.line((0, y, width, y), fill=color)

    # Draw grid effect
    for x in range(0, width, 20):
        alpha = abs(math.sin((x + wave_offset) * 0.05)) * 0.3
        grid_color = tuple(int(c * alpha) for c in NEON_BLUE)
        draw.line((x, 0, x, height), fill=grid_color)

    # Get system status
    api_status = get_api_status()
    redis_status = get_redis_status()
    cpu, memory, disk = get_system_info()

    # Draw header with rainbow effect
    rainbow_color = get_rainbow_color(animation_frame * 2)
    draw.rectangle((0, 0, width, 50), fill=DARKER_BG)
    draw_glowing_line(0, 50, width, 50, rainbow_color, 2)
    
    title_color = get_rainbow_color(animation_frame * 2 + 180)
    draw.text((10, 10), "Product Search API", font=font_title, fill=title_color)

    # Draw status boxes
    draw_status_box(10, 60, "API Status", api_status, NEON_BLUE)
    draw_status_box(160, 60, "Redis", redis_status, NEON_PURPLE)

    # System metrics section
    y = 130
    section_title = "SYSTEM METRICS"
    draw.text((10, y), section_title, font=font_small, fill=NEON_PINK)
    draw_glowing_line(10, y+20, 10+font_small.getlength(section_title), y+20, NEON_PINK)

    # Draw metrics with cyber style
    y += 25
    metrics = [
        ("CPU", cpu, NEON_BLUE),
        ("RAM", memory, NEON_PURPLE),
        ("DISK", disk, CYBER_GREEN)
    ]

    for label, value, color in metrics:
        draw_loading_circle(35, y + 15, 15, value/100, color)
        draw.text((60, y), label, font=font_small, fill=color)
        draw_progress_bar(60, y + 20, 150, 6, value/100, color)
        
        # Draw percentage with glow
        value_text = f"{value}%"
        draw.text((216, y), value_text, font=font_mono, fill=DARKER_BG)
        draw.text((215, y), value_text, font=font_mono, fill=color)
        
        y += 45

    # Draw time with rainbow effect
    current_time = time.strftime("%H:%M:%S")
    time_color = get_rainbow_color(animation_frame * 3)
    time_x = width//2 - font_mono.getlength(current_time)//2
    draw.text((time_x+1, height-30), current_time, font=font_mono, fill=DARKER_BG)
    draw.text((time_x, height-31), current_time, font=font_mono, fill=time_color)

    # Display the image
    disp.image(image)

def main():
    print("Starting Cyberpunk API Display...")
    while True:
        try:
            update_display()
            time.sleep(0.05)
        except Exception as e:
            print(f"Error updating display: {e}")
            time.sleep(1)

if __name__ == "__main__":
    main() 